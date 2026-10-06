# Hướng dẫn đưa a2matex-be lên VPS

Thiết kế và lý do nằm ở [deployment-spec.md](deployment-spec.md). Tài liệu này chỉ là các bước thao tác.

Có hai phần. Phần A làm một lần khi thiết lập, bắt đầu từ A0 nếu bạn tạo máy trên Google Cloud, hoặc từ A1 nếu đã có VPS. Sau đó mọi lần deploy đều tự động ở phần B.

## A. Thiết lập lần đầu

Thứ tự quan trọng: chuẩn bị VPS và secrets trước, push code sau, để lần chạy workflow đầu tiên deploy được luôn.

### A0. Tạo máy trên Google Cloud bằng gcloud

Bỏ qua mục này nếu bạn đã có VPS ở nơi khác. Google Cloud khác VPS thường ở ba chỗ: tường lửa nằm ở lớp mạng VPC chứ không chỉ trong máy, IP mặc định là IP tạm có thể đổi khi tắt bật, và user SSH được tạo qua metadata của máy chứ không phải `ssh-copy-id`. Các lệnh dưới đây xử lý cả ba.

Cần có sẵn `gcloud` CLI và một dự án đã bật billing. Đặt biến dùng lại cho cả mục:

```bash
export PROJECT_ID=<id dự án của bạn>
export REGION=asia-southeast1
export ZONE=asia-southeast1-b
export VM=a2matex-vps

gcloud auth login
gcloud config set project "$PROJECT_ID"
gcloud config set compute/zone "$ZONE"
gcloud services enable compute.googleapis.com
```

Singapore là vùng gần Việt Nam nhất. Đổi `REGION` và `ZONE` nếu bạn muốn nơi khác, hai giá trị phải cùng vùng.

**Đặt IP tĩnh trước**, để tên miền không bị trỏ sai khi máy khởi động lại:

```bash
gcloud compute addresses create a2matex-ip --region="$REGION"
gcloud compute addresses describe a2matex-ip --region="$REGION" --format='value(address)'
```

Ghi lại IP in ra. Đây là giá trị cho bản ghi A ở bước A2 và cho secret `VPS_HOST` ở bước A4.

**Mở cổng web ở tường lửa VPC.** Lệnh `ufw` ở A1 chỉ mở trong máy, không đủ:

```bash
gcloud compute firewall-rules create a2matex-allow-web \
  --network=default --direction=INGRESS --action=ALLOW \
  --rules=tcp:80,tcp:443,udp:443 --source-ranges=0.0.0.0/0 \
  --target-tags=a2matex-web
```

Mạng `default` đã có sẵn rule cho SSH cổng 22. Nếu bạn dùng VPC tự tạo thì thêm một rule tương tự cho `tcp:22`.

**Tạo máy.** e2-medium có 2 vCPU và 4 GB RAM, thoải mái cho Postgres, Redis, API và Caddy chạy cùng lúc, còn dư để Postgres dùng làm cache. Muốn tiết kiệm thì e2-small 2 GB vẫn chạy được vì không build trên máy.

```bash
gcloud compute instances create "$VM" \
  --machine-type=e2-medium \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-balanced \
  --address=a2matex-ip \
  --tags=a2matex-web
```

**Tạo user `deploy` cho CI và cho chính bạn.** Tạo khóa trên máy bạn rồi đưa khóa công khai vào metadata của máy. Guest agent của Google sẽ tự tạo user Linux tên `deploy` có quyền sudo:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/a2matex-deploy -N "" -C "github-actions-a2matex"
echo "deploy:$(cat ~/.ssh/a2matex-deploy.pub)" > /tmp/a2matex-ssh-keys
gcloud compute instances add-metadata "$VM" --metadata-from-file ssh-keys=/tmp/a2matex-ssh-keys
rm /tmp/a2matex-ssh-keys
```

Đợi khoảng 30 giây rồi kiểm tra:

```bash
ssh -i ~/.ssh/a2matex-deploy deploy@<IP tĩnh> 'whoami && sudo -n true && echo sudo OK'
```

Từ đây trở đi, **mọi lệnh trên VPS chạy bằng user `deploy` qua khóa này**, kể cả bước A1. Nhờ vậy `deploy` sở hữu `/opt/a2matex` và thuộc group `docker`, đúng những gì CI cần. Nếu bạn vào máy bằng `gcloud compute ssh` thì Google tạo một user khác theo tài khoản của bạn, và các bước phân quyền ở A1 sẽ gán nhầm cho user đó.

Nếu `ssh deploy@...` báo Permission denied dù đã đợi, nhiều khả năng dự án đang bật OS Login khiến metadata bị bỏ qua. Tắt riêng cho máy này:

```bash
gcloud compute instances add-metadata "$VM" --metadata enable-oslogin=FALSE
```

Chi phí tham khảo tại Singapore: e2-medium khoảng 30 USD một tháng, e2-small khoảng 15 USD, cộng khoảng 3 USD cho ổ đĩa 30 GB, chưa kể lưu lượng ra ngoài.

### A1. Cài Docker và tường lửa trên VPS

VPS Ubuntu 22.04 hoặc 24.04, 1 GB RAM là đủ vì không build trên đó.

Nếu đã làm A0 trên Google Cloud, đăng nhập bằng `ssh -i ~/.ssh/a2matex-deploy deploy@<IP tĩnh>` rồi chạy tiếp. Biến `$USER` khi đó là `deploy`.

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
newgrp docker
docker compose version

sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

sudo mkdir -p /opt/a2matex/deploy
sudo chown -R "$USER" /opt/a2matex
```

Không mở cổng 5432 và 6379. Postgres và Redis chỉ nằm trên mạng nội bộ của Docker.

### A2. Trỏ tên miền

Tạo bản ghi A cho tên miền API về IP của VPS. Caddy cần tên miền phân giải được và cổng 80 mở để xin chứng chỉ.

```bash
dig +short api.tenmien.com
```

**Chưa có tên miền?** Dùng `sslip.io`, dịch vụ DNS công cộng miễn phí: tên `<IP với dấu gạch>.sslip.io` tự phân giải về IP đó, ví dụ `34-87-57-207.sslip.io` về `34.87.57.207`. Let's Encrypt cấp chứng chỉ thật cho tên này nên có HTTPS ngay. Điền tên đó vào `APP_DOMAIN`, sau này có tên miền riêng thì đổi một dòng và Caddy tự xin chứng chỉ mới.

### A3. Tạo khóa SSH riêng cho CI

Nếu đã làm A0 trên Google Cloud thì khóa đã tạo và đã đưa lên máy, chỉ cần chạy lệnh kiểm tra ở cuối mục này.

Chạy trên máy bạn, không dùng lại khóa cá nhân:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/a2matex-deploy -N "" -C "github-actions-a2matex"
```

Đưa khóa công khai lên VPS:

```bash
ssh-copy-id -i ~/.ssh/a2matex-deploy.pub user@ip-vps
```

Kiểm tra đăng nhập được bằng khóa đó:

```bash
ssh -i ~/.ssh/a2matex-deploy user@ip-vps 'docker ps'
```

### A4. Khai báo secrets trên GitHub

Vào repo, Settings, Secrets and variables, Actions, New repository secret.

| Tên | Giá trị |
| --- | --- |
| `VPS_HOST` | IP hoặc hostname của VPS |
| `VPS_USER` | user đã tạo ở A1 |
| `VPS_SSH_KEY` | toàn bộ nội dung file `~/.ssh/a2matex-deploy`, kể cả dòng đầu và dòng cuối |
| `VPS_PORT` | chỉ khai báo nếu SSH không dùng cổng 22 |

Với máy tạo theo A0: `VPS_HOST` là IP tĩnh, `VPS_USER` là `deploy`.

Lấy nội dung khóa riêng bằng:

```bash
cat ~/.ssh/a2matex-deploy
```

### A5. Tạo file biến môi trường trên VPS

```bash
ssh user@ip-vps
cd /opt/a2matex
```

Chép nội dung file `.env.production.example` trong repo vào `/opt/a2matex/.env.production` rồi điền giá trị. Cách nhanh nhất là chép từ máy bạn:

```bash
scp .env.production.example user@ip-vps:/opt/a2matex/.env.production
ssh user@ip-vps 'chmod 600 /opt/a2matex/.env.production && nano /opt/a2matex/.env.production'
```

Sinh hai khóa JWT, mỗi khóa một chuỗi riêng:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Các giá trị bắt buộc phải sửa:

| Biến | Điền gì |
| --- | --- |
| `IMAGE_REPO` | `ghcr.io/<tên org viết thường>/a2matex-be`. Với org `A2MaTex` là `ghcr.io/a2matex/a2matex-be` |
| `APP_DOMAIN` | tên miền ở A2 |
| `ACME_EMAIL` | email của bạn |
| `CORS_ORIGIN` | domain frontend, ví dụ `https://app.tenmien.com` |
| `POSTGRES_PASSWORD` | mật khẩu mạnh, và sửa cùng chuỗi đó bên trong `DATABASE_URL` |
| `REDIS_PASSWORD` | mật khẩu mạnh |
| `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET` | hai chuỗi vừa sinh |
| `RESEND_API_KEY` | khóa từ Resend |
| `EMAIL_FROM` | địa chỉ thuộc domain đã xác thực trên Resend |
| `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | tài khoản quản trị đầu tiên |

Script deploy sẽ từ chối chạy nếu file còn chuỗi `CHANGE_ME`.

### A6. Commit và push

Trên máy bạn, ở thư mục repo:

```bash
git add .
git commit -m "feat: add Docker image, Caddy stack and GitHub Actions deploy pipeline"
git push origin staging
```

Vào tab Actions của repo, theo dõi workflow **Deploy**. Job đầu build image và đẩy lên GHCR, job sau đồng bộ thư mục `deploy/` sang VPS rồi chạy script. Lần đầu mất khoảng 4 đến 6 phút.

Nếu job build báo lỗi 403 khi đẩy image, vào Settings, Actions, General, Workflow permissions và chọn Read and write permissions.

### A7. Seed dữ liệu ban đầu

Việc này chạy tay trên VPS, chỉ sau khi workflow báo thành công. Tạo alias để khỏi gõ lại lệnh dài:

```bash
ssh user@ip-vps
cat >> ~/.bashrc <<'EOF'
alias a2c='docker compose --env-file /opt/a2matex/.env.production --env-file /opt/a2matex/.env.deploy -f /opt/a2matex/deploy/docker-compose.prod.yaml'
EOF
source ~/.bashrc
```

Chạy hai job seed theo thứ tự:

```bash
a2c --profile seed run --rm seed-roles
a2c --profile seed run --rm seed-permissions
```

Job đầu tạo 3 role và tài khoản admin. Job sau quét toàn bộ route và gán hết cho role ADMIN.

Nếu chạy hai job này từ xa bằng `ssh ... 'bash -s' < script`, thêm `< /dev/null` vào cuối mỗi lệnh `run`, vì `docker compose run` sẽ đọc phần script còn lại từ stdin và script dừng ngay sau job đầu tiên.

### A8. Kiểm tra

```bash
curl https://api.tenmien.com/api/v1/health
```

Phải trả về `{"data":{"status":"ok",...},"statusCode":200}`.

```bash
curl -X POST https://api.tenmien.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"<ADMIN_USERNAME>","password":"<ADMIN_PASSWORD>"}'
```

Phải trả về `accessToken` và `refreshToken`.

Tài liệu API dạng Swagger UI mở công khai tại `https://api.tenmien.com/api/v1/docs`. Bấm Authorize, dán access token để gọi thử các route có khóa ngay trên trang.

## B. Vận hành

### Deploy

Merge vào `staging`. Không phải làm gì thêm. Theo dõi ở tab Actions. Nhánh `main` không còn tự deploy; muốn đưa `main` lên thì merge nó vào `staging`.

### Sau khi thêm hoặc sửa route

Bắt buộc chạy lại seed permission, nếu không route mới trả 403 cho tất cả mọi người kể cả admin:

```bash
a2c --profile seed run --rm seed-permissions
```

Không chạy lại `seed-roles` trừ khi muốn đặt lại mật khẩu admin theo giá trị trong `.env.production`.

### Quay lui

1. Tìm tag muốn quay về. Mỗi lần deploy thành công in tag ở phần Summary của workflow, dạng `sha-1a2b3c4`. Hoặc xem danh sách ở trang Packages của org.
2. Vào tab Actions, chọn workflow Deploy, bấm Run workflow, điền tag vào ô `image_tag`, chạy.

Job build bị bỏ qua, job deploy kéo đúng tag đó về. Quay lui app không quay lui database.

### Xem trạng thái và log

```bash
a2c ps
a2c logs -f app
a2c logs -f caddy
cat /opt/a2matex/.env.deploy      # tag đang chạy
```

### Sao lưu và khôi phục

Sao lưu:

```bash
mkdir -p /opt/a2matex/backups
docker exec a2matex-postgres pg_dump -U a2matex -d a2matex -Fc \
  > "/opt/a2matex/backups/db-$(date +%F-%H%M).dump"
```

Khôi phục:

```bash
cat /opt/a2matex/backups/db-2026-01-01-0300.dump | docker exec -i a2matex-postgres \
  pg_restore -U a2matex -d a2matex --clean --if-exists
```

Đặt lịch hằng ngày lúc 3 giờ sáng, giữ 14 bản:

```bash
crontab -e
```

```
0 3 * * * docker exec a2matex-postgres pg_dump -U a2matex -d a2matex -Fc > /opt/a2matex/backups/db-$(date +\%F).dump && find /opt/a2matex/backups -name 'db-*.dump' -mtime +14 -delete
```

Bản sao lưu vẫn nằm trên VPS. Nên chép định kỳ ra nơi khác.

### Vào database từ máy bạn

Không mở cổng public. Dùng psql qua container:

```bash
ssh user@ip-vps
docker exec -it a2matex-postgres psql -U a2matex -d a2matex
```

## C. Sự cố thường gặp

| Triệu chứng | Nguyên nhân thường gặp | Xử lý |
| --- | --- | --- |
| Job deploy fail ở bước chờ healthy | biến môi trường sai hoặc migration lỗi | script đã in 50 dòng log cuối của migrate và app ngay trong Actions |
| App khởi động rồi thoát ngay | thiếu hoặc sai biến | `a2c logs app`, thông báo liệt kê đúng tên biến |
| Mọi request trả 403 dù token hợp lệ | chưa seed permission cho route mới | chạy `seed-permissions` |
| `curl` tên miền trả 502 | `HOST` trong env là `localhost`, hoặc app chưa lên | sửa `HOST=0.0.0.0`, `a2c logs app` |
| Caddy không xin được chứng chỉ | DNS chưa trỏ, hoặc cổng 80 bị chặn | `dig`, `ufw status`, `a2c logs caddy` |
| IP trong log là IP nội bộ Docker | `TRUST_PROXY` không phải `1` | sửa env, `a2c up -d app` |
| Job build fail 403 khi push image | workflow chưa có quyền ghi package | Settings, Actions, General, Read and write permissions |
| Job deploy fail ở rsync hoặc ssh | khóa hoặc user sai, hoặc thư mục chưa tồn tại | thử `ssh -i ~/.ssh/a2matex-deploy user@ip 'ls /opt/a2matex'` từ máy bạn |
| `ssh deploy@ip` bị Permission denied trên Google Cloud | OS Login đang bật nên metadata ssh-keys bị bỏ qua | `gcloud compute instances add-metadata <VM> --metadata enable-oslogin=FALSE` |
| Tên miền không vào được dù `ufw` đã mở | thiếu firewall rule ở lớp VPC | xem lại lệnh tạo rule `a2matex-allow-web` ở A0 |
