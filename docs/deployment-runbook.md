# Hướng dẫn đưa a2matex-be lên VPS

Thiết kế và lý do nằm ở [`specs/001-vps-deployment/spec.md`](../specs/001-vps-deployment/spec.md) (pipeline, VM, HTTPS) và
[`specs/004-cloud-sql-postgres/spec.md`](../specs/004-cloud-sql-postgres/spec.md) (Postgres trên Cloud SQL, truy cập cho dev).
Tài liệu này chỉ là các bước thao tác.

Có hai phần. Phần A làm một lần khi thiết lập, bắt đầu từ A0 nếu bạn tạo máy trên Google Cloud, hoặc từ A1 nếu đã có VPS. Sau đó mọi lần deploy đều tự động ở phần B.

## A. Thiết lập lần đầu

Thứ tự quan trọng: chuẩn bị VPS và secrets trước, push code sau, để lần chạy workflow đầu tiên deploy được luôn.

### A0. Tạo máy trên Google Cloud bằng gcloud

Bỏ qua mục này nếu bạn đã có VPS ở nơi khác. Google Cloud khác VPS thường ở ba chỗ: tường lửa nằm ở lớp mạng VPC chứ không chỉ trong máy, IP mặc định là IP tạm có thể đổi khi tắt bật, và user SSH được tạo qua metadata của máy chứ không phải `ssh-copy-id`. Các lệnh dưới đây xử lý cả ba.

Cần có sẵn `gcloud` CLI và một dự án đã bật billing. Đặt biến dùng lại cho cả mục:

```bash
export PROJECT_ID=a2matex-prod
export REGION=asia-southeast1
export ZONE=asia-southeast1-b
export VM=a2matex-vps
export IP_NAME=a2matex-ip

gcloud auth login
gcloud config set project "$PROJECT_ID"
gcloud config set compute/zone "$ZONE"
gcloud services enable compute.googleapis.com
```

Singapore là vùng gần Việt Nam nhất. Đổi `REGION` và `ZONE` nếu bạn muốn nơi khác, hai giá trị phải cùng vùng.

**Hiện trạng 2026-10-20:** production được dựng lại từ đầu trong project mới `a2matex-prod`
(tài khoản Google mới, tài khoản cũ hết credit). Máy là `a2matex-vps`, IP tĩnh `a2matex-ip` =
`34.87.159.150`, e2-small. Máy cũ `34.87.57.207` nằm trong project
`robust-habitat-505713-b6` của tài khoản cũ, xem mục B "Gỡ VM cũ". Nếu dựng thêm một máy trong
cùng project thì đặt tên khác cho máy và IP, và bỏ qua lỗi "already exists" của firewall rule.

**Đặt IP tĩnh trước**, để tên miền không bị trỏ sai khi máy khởi động lại:

```bash
gcloud compute addresses create "$IP_NAME" --region="$REGION"
gcloud compute addresses describe "$IP_NAME" --region="$REGION" --format='value(address)'
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

**Tạo máy.** e2-small có 2 vCPU chia sẻ và 2 GB RAM, đủ cho API, Redis và Caddy vì Postgres nằm trên Cloud SQL (A5) và không build gì trên máy. Chọn e2-medium 4 GB nếu muốn dư tài nguyên. Đĩa 20 GB là đủ vì dữ liệu Postgres không còn nằm trên máy; `--metadata=enable-oslogin=FALSE` để khoá SSH đưa qua metadata ở bước dưới có hiệu lực ngay.

```bash
gcloud compute instances create "$VM" \
  --machine-type=e2-small \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=20GB --boot-disk-type=pd-balanced \
  --address="$IP_NAME" \
  --tags=a2matex-web \
  --metadata=enable-oslogin=FALSE
```

**Tạo user `deploy` cho CI và cho chính bạn.** Tạo khóa trên máy bạn rồi đưa khóa công khai vào metadata của máy. Guest agent của Google sẽ tự tạo user Linux tên `deploy` có quyền sudo. Đã có `~/.ssh/a2matex-deploy` từ máy cũ thì bỏ dòng `ssh-keygen`, dùng lại khoá đó; secret `VPS_SSH_KEY` trên GitHub nhờ vậy không đổi:

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

Chi phí tham khảo tại Singapore: e2-small khoảng 15 USD một tháng, e2-medium khoảng 30 USD, cộng khoảng 2 USD cho ổ đĩa 20 GB, chưa kể lưu lượng ra ngoài. Cloud SQL `db-g1-small` ở A5 khoảng 30 USD.

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

Máy e2-small chỉ có 2 GB RAM và không có swap mặc định. Thêm 1 GB swap làm đệm khi kéo image
hay khi Node tạm vượt mức, để tránh OOM killer giết container:

```bash
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

Không `ufw allow` 5432 hay 6379. Postgres không chạy trên VPS: nó nằm trên Cloud SQL và app nối
tới IP nội bộ trong VPC (A5), không qua internet. Redis chỉ nằm trong mạng Docker và loopback của
VPS, vào từ máy cá nhân bằng SSH tunnel (A10). Lưu ý `ufw` không chặn được cổng do Docker publish,
nên không dựa vào nó cho hai cổng này; tường lửa VPC mới là chốt chặn.

### A2. Trỏ tên miền

Tạo bản ghi A cho tên miền API về IP của VPS. Caddy cần tên miền phân giải được và cổng 80 mở để xin chứng chỉ.

Production dùng `api.a2matex.com`; từ 2026-10-20 bản ghi A phải trỏ về IP máy mới `34.87.159.150`
(trước đó là `34.87.57.207`, máy cũ). Tên miền `a2matex.com` đăng ký tại Nhân Hòa, DNS quản tại `zonedns.vn` với
nameserver `ns1-4.zonedns.vn`; trang đó đăng nhập bằng **chính tên miền** làm tên tài khoản,
không phải email.

```bash
dig +short api.a2matex.com
```

**Đang thay VM cũ bằng VM mới?** Caddy trên máy mới chỉ xin được chứng chỉ khi tên miền đã trỏ về
IP mới, nên trỏ DNS ngay sau khi xong A0 và A1, trước lần deploy đầu tiên. Từ lúc đó máy cũ ngừng
phục vụ tên miền; chấp nhận vì đây là dựng lại từ đầu, không chuyển dữ liệu. Sửa bản ghi A
`api.a2matex.com` sang IP tĩnh mới tại zonedns.vn, kiểm tra cả bốn nameserver bằng lệnh ở mục
"Đổi sang tên miền khác" bên dưới, rồi mới làm A5 trở đi.

**Chưa có tên miền?** Dùng `sslip.io`, dịch vụ DNS công cộng miễn phí: tên `<IP với dấu gạch>.sslip.io` tự phân giải về IP đó, ví dụ `34-87-57-207.sslip.io` về `34.87.57.207`. Let's Encrypt cấp chứng chỉ thật cho tên này nên có HTTPS ngay. Điền tên đó vào `APP_DOMAIN`, sau này có tên miền riêng thì làm theo mục ngay dưới.

#### Đổi sang tên miền khác về sau

`deploy/Caddyfile` chỉ có **một** site block khoá theo `APP_DOMAIN`. Đổi biến đó sang tên chưa
phân giải được thì Caddy vừa ngừng phục vụ tên cũ vừa xin chứng chỉ thất bại, và Let's Encrypt
giới hạn số lần hỏng mỗi giờ. Luôn làm đúng thứ tự:

1. Tạo bản ghi A cho tên mới về IP của VPS, TTL thấp (300) cho lần đầu.
2. Xác nhận **mọi** nameserver của zone đã trả đúng IP trước khi đụng VPS. Nhân Hòa đồng bộ
   lệch nhau vài chục giây giữa `ns1` và `ns4`:
   ```bash
   for ns in ns1 ns2 ns3 ns4; do dig +short A api.<tên mới> @$ns.zonedns.vn; done
   ```
3. Trên VPS, đổi một dòng rồi khởi động lại Caddy. Lưu ý: `app` cũng đọc chính
   `.env.production` qua `env_file`, nên Compose phát hiện file đổi và **tạo lại cả `app`**
   dù bạn chỉ gọi tên `caddy`. Đã kiểm ngày 2026-10-08: `a2matex-app` và `a2matex-caddy`
   cùng khởi động lại, chấp nhận một nhịp gián đoạn ngắn vài giây. `postgres` và `redis`
   không bị đụng:
   ```bash
   cd /opt/a2matex
   cp .env.production .env.production.bak
   sed -i 's/^APP_DOMAIN=.*/APP_DOMAIN=api.<tên mới>/' .env.production
   a2c up -d caddy && a2c logs -f caddy
   ```
   Volume `caddy-data` giữ nguyên nên chứng chỉ cũ không mất.
4. Kiểm từ ngoài. `curl` trên máy không phân giải được tên mới thì chỉ định IP thủ công, đừng
   vội kết luận là sập:
   ```bash
   curl -sI --resolve api.<tên mới>:443:<IP> https://api.<tên mới>/api/v1/docs
   echo | openssl s_client -connect <IP>:443 -servername api.<tên mới> 2>/dev/null \
     | openssl x509 -noout -subject -issuer -dates
   ```

Sau khi đổi, tên cũ ngừng phục vụ hoàn toàn. Muốn giữ song song hai tên thì phải sửa
`deploy/Caddyfile` cho site block nhận cả hai hostname, tức là một commit, một lần deploy, **và**
`a2c up -d --force-recreate caddy` sau deploy: Caddyfile là bind mount một file, rsync của CI ghi
file mới (inode mới) nên container vẫn thấy bản cũ cho tới khi được tạo lại, kể cả khi gọi
`caddy reload`.

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

### A5. Tạo Postgres trên Cloud SQL

Thiết kế và lý do ở [`specs/004-cloud-sql-postgres/spec.md`](../specs/004-cloud-sql-postgres/spec.md).
Tóm tắt: một instance Cloud SQL for PostgreSQL 17 trong cùng project và cùng VPC `default` với
VM; app nối qua **Private IP**, bắt buộc SSL; dev nối qua Cloud SQL Auth Proxy bằng tài khoản
Google (A10). Postgres không còn trong compose. Mọi lệnh `gcloud` ở đây chạy trong Cloud Shell
trên console nếu máy bạn không cài `gcloud`.

#### A5.1 Bật API

```bash
gcloud config set project a2matex-prod
gcloud services enable sqladmin.googleapis.com servicenetworking.googleapis.com
```

#### A5.2 Private Service Access, làm một lần cho project

Cầu nối để Cloud SQL có một IP `10.x` trong VPC `default`, nơi VM đang đứng. Console: VPC
network, mạng `default`, tab Private services access, Allocate IP range rồi Create connection.
Bằng lệnh:

```bash
gcloud compute addresses create google-managed-services-default \
  --global --purpose=VPC_PEERING --prefix-length=20 --network=default
gcloud services vpc-peerings connect \
  --service=servicenetworking.googleapis.com \
  --ranges=google-managed-services-default --network=default
```

Không cần firewall rule: VM đi ra range này theo luật egress mặc định, còn phía Cloud SQL tự
kiểm soát ai được vào. Đã có từ trước thì hai lệnh báo "already exists", bỏ qua.

#### A5.3 Tạo instance

Console: SQL, Create instance, PostgreSQL, edition **Enterprise** (không phải Enterprise Plus).

| Mục | Giá trị |
| --- | --- |
| Instance ID | `a2matex-pg` |
| Mật khẩu user `postgres` | `openssl rand -base64 24`, lưu vào trình quản lý mật khẩu |
| Database version | PostgreSQL 17 |
| Region, zone | `asia-southeast1`, Single zone, `asia-southeast1-b` |
| Machine | Shared core, 1 vCPU, 1.7 GB (`db-g1-small`) |
| Storage | SSD, 10 GB, bật Enable automatic storage increases |
| Connections | tick **Private IP** mạng `default`; tick **Public IP**; **không** thêm Authorized network |
| Security, SSL mode | Allow only SSL connections |
| Data protection | Automated backups bật; Point-in-time recovery bật; Deletion protection bật |
| Maintenance | Sunday, 03:00 giờ Việt Nam |

Bằng lệnh (giờ ghi theo UTC, `20:00` là 03:00 sáng Việt Nam), tạo mất 5 tới 10 phút:

```bash
gcloud sql instances create a2matex-pg \
  --database-version=POSTGRES_17 --edition=ENTERPRISE --tier=db-g1-small \
  --region=asia-southeast1 --zone=asia-southeast1-b --availability-type=ZONAL \
  --storage-type=SSD --storage-size=10GB --storage-auto-increase \
  --network=projects/a2matex-prod/global/networks/default --assign-ip \
  --ssl-mode=ENCRYPTED_ONLY \
  --backup-start-time=20:00 --enable-point-in-time-recovery \
  --retained-backups-count=7 --retained-transaction-log-days=7 \
  --maintenance-window-day=SUN --maintenance-window-hour=20 \
  --deletion-protection \
  --root-password='<mật khẩu postgres>'
```

Public IP chỉ để Auth Proxy của dev nối tới (A10); không có authorized network nên kết nối
thẳng từ internet bị từ chối. Ghi lại hai giá trị dùng ở các bước sau:

```bash
gcloud sql instances describe a2matex-pg --format='table(ipAddresses[].type,ipAddresses[].ipAddress)'
gcloud sql instances describe a2matex-pg --format='value(connectionName)'
```

Dòng `PRIVATE` là IP cho `DATABASE_URL` ở A6. `connectionName` có dạng
`a2matex-prod:asia-southeast1:a2matex-pg`, dùng cho Auth Proxy.

#### A5.4 Database và role của app

Tạo database bằng console (tab Databases, Create database, tên `a2matex`) hoặc:

```bash
gcloud sql databases create a2matex --instance=a2matex-pg
```

**Không** tạo user `a2matex` ở tab Users của console: user tạo ở đó được cấp `cloudsqlsuperuser`.
Thay vào đó mở **Cloud SQL Studio** trong trang instance, đăng nhập database `postgres`, user
`postgres`, và chạy:

```sql
CREATE ROLE a2matex LOGIN PASSWORD '<mật khẩu app, sinh bằng openssl rand -base64 24>';
GRANT a2matex TO postgres;
ALTER DATABASE a2matex OWNER TO a2matex;
```

Role app là chủ database nhưng không phải superuser. Migration của Prisma chạy bằng role này
nên mọi bảng sẽ thuộc nó. Mật khẩu này điền vào `POSTGRES_PASSWORD` và `DATABASE_URL` ở A6.

#### A5.5 Role nhóm cho dev

Vẫn trong Cloud SQL Studio, đổi sang database `a2matex` (user `postgres`), dán toàn bộ
`deploy/postgres/roles.sql` và chạy. File tạo `db_readonly` và `db_readwrite` (không LOGIN) kèm
quyền cho bảng hiện có và bảng do migration tạo về sau. Chạy lại không lỗi. Tài khoản từng dev
tạo ở A10.1.

#### A5.6 Kiểm tra từ VPS

Chạy trên VPS sau A1, dùng image Postgres chỉ để có `psql`. Kỳ vọng lần lượt: trả về `1`, bị từ
chối vì không SSL, hết giờ vì Public IP không có authorized network.

```bash
PG=postgres:17-alpine
docker run --rm -e PGPASSWORD='<mật khẩu app>' $PG \
  psql "postgresql://a2matex@<PRIVATE_IP>:5432/a2matex?sslmode=require" -c 'select 1'
docker run --rm -e PGPASSWORD='<mật khẩu app>' $PG \
  psql "postgresql://a2matex@<PRIVATE_IP>:5432/a2matex?sslmode=disable" -c 'select 1'
docker run --rm -e PGPASSWORD='<mật khẩu app>' $PG \
  psql "postgresql://a2matex@<PUBLIC_IP>:5432/a2matex?sslmode=require" -c 'select 1'
```

Lệnh đầu hết giờ thì xem lại A5.2 (Private Service Access) và IP ở A5.3.

### A6. Tạo file biến môi trường trên VPS

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
| `APP_DOMAIN` | tên miền ở A2. Production hiện là `api.a2matex.com` |
| `ACME_EMAIL` | email của bạn |
| `CORS_ORIGIN` | domain frontend, ví dụ `https://app.a2matex.com`. Chưa có frontend thì để `*`: API vẫn gọi được từ Swagger, curl, Postman, nhưng trình duyệt sẽ không gửi cookie đăng nhập cho tới khi đặt domain cụ thể. Đổi sau bằng `sed -i` vào file rồi `a2c up -d app` |
| `POSTGRES_HOST` | Private IP của instance Cloud SQL, lấy ở A5.3 |
| `POSTGRES_PASSWORD` | mật khẩu role app tạo ở A5.4, và sửa cùng chuỗi đó bên trong `DATABASE_URL` |
| `DATABASE_URL` | `postgresql://a2matex:<mật khẩu>@<PRIVATE_IP>:5432/a2matex?schema=public&sslmode=require&uselibpqcompat=true`, giữ nguyên hai tham số cuối |
| `REDIS_PASSWORD` | mật khẩu mạnh |
| `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET` | hai chuỗi vừa sinh |
| `RESEND_API_KEY` | khóa từ Resend |
| `EMAIL_FROM` | địa chỉ thuộc domain đã xác thực trên Resend |
| `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | tài khoản quản trị đầu tiên |

Script deploy sẽ từ chối chạy nếu file còn chuỗi `CHANGE_ME`.

Hai tham số cuối của `DATABASE_URL` bắt buộc và có lý do riêng. `sslmode=require` vì Cloud SQL chỉ
nhận kết nối SSL. `uselibpqcompat=true` vì driver `pg` mà app dùng mặc định xác minh chứng chỉ máy
chủ theo CA hệ thống, trong khi Cloud SQL ký bằng CA riêng của Google; thiếu nó app báo
`self-signed certificate in certificate chain`. Prisma CLI (job `migrate`) bỏ qua tham số lạ nên
cùng một URL dùng được cho cả hai.

### A7. Commit và push

Trên máy bạn, ở thư mục repo:

```bash
git add .
git commit -m "feat: add Docker image, Caddy stack and GitHub Actions deploy pipeline"
git push origin staging
```

Vào tab Actions của repo, theo dõi workflow **Deploy**. Job đầu build image và đẩy lên GHCR, job sau đồng bộ thư mục `deploy/` sang VPS rồi chạy script. Lần đầu mất khoảng 4 đến 6 phút.

Nếu job build báo lỗi 403 khi đẩy image, vào Settings, Actions, General, Workflow permissions và chọn Read and write permissions.

### A8. Seed dữ liệu ban đầu

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

### A9. Kiểm tra

```bash
curl https://api.a2matex.com/api/v1/health
```

Phải trả về `{"data":{"status":"ok",...},"statusCode":200}`.

```bash
curl -X POST https://api.a2matex.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"<ADMIN_USERNAME>","password":"<ADMIN_PASSWORD>"}'
```

Phải trả về `accessToken` và `refreshToken`.

Tài liệu API dạng Swagger UI mở công khai tại `https://api.a2matex.com/api/v1/docs`. Bấm Authorize, dán access token để gọi thử các route có khóa ngay trên trang.

### A10. Truy cập Postgres và Redis từ máy cá nhân

Postgres qua Cloud SQL Auth Proxy bằng tài khoản Google, Redis qua SSH tunnel bằng khoá riêng.
Không mở thêm cổng nào trên VPS hay trên Cloud SQL. Thiết kế ở spec 004; phần Redis kế thừa
spec 003.

#### A10.1 Postgres: Auth Proxy cho dev

Chủ repo làm hai việc cho mỗi dev. Lệnh đầu trong Cloud Shell, lệnh sau trong Cloud SQL Studio
(database `a2matex`, user `postgres`), yêu cầu A5.5 đã chạy:

```bash
gcloud projects add-iam-policy-binding a2matex-prod \
  --member='user:<email Google của dev>' --role='roles/cloudsql.client'
```

```sql
CREATE ROLE <tên dev> LOGIN PASSWORD '<mật khẩu sinh ngẫu nhiên>' IN ROLE db_readonly CONNECTION LIMIT 5;
```

Dùng `db_readwrite` thay `db_readonly` khi chủ repo quyết định cho ghi. Gửi mật khẩu qua kênh
riêng, không dán vào chat lưu lâu dài.

Dev cài một lần trên máy mình, rồi mỗi lần làm việc chỉ chạy lệnh cuối:

```bash
brew install --cask google-cloud-sdk
brew install cloud-sql-proxy
gcloud auth login
cloud-sql-proxy --gcloud-auth --port 5433 a2matex-prod:asia-southeast1:a2matex-pg
```

GUI hoặc `psql` trỏ `127.0.0.1:5433`, database `a2matex`, user và mật khẩu riêng, SSL tắt ở
phía GUI vì proxy đã mã hoá và xác thực bằng IAM. Chạy backend cục bộ trên dữ liệu Cloud SQL:
`DATABASE_URL="postgresql://<tên dev>:<mật khẩu>@127.0.0.1:5433/a2matex?schema=public"`. Dev
không có role IAM thì proxy từ chối trước khi hỏi mật khẩu database.

#### A10.2 Redis: user tunnel trên VPS

Compose đã publish Redis lên `127.0.0.1:6379` của VPS, chỉ loopback. Tạo user `dbtunnel` không có
shell, chỉ được forward tới cổng đó:

```bash
sudo useradd --system --create-home --home-dir /home/dbtunnel --shell /usr/sbin/nologin dbtunnel
sudo install -d -m 0700 -o dbtunnel -g dbtunnel /home/dbtunnel/.ssh
sudo install -m 0600 -o dbtunnel -g dbtunnel /dev/null /home/dbtunnel/.ssh/authorized_keys
sudo install -m 0644 /opt/a2matex/deploy/ssh/70-dbtunnel.conf /etc/ssh/sshd_config.d/70-dbtunnel.conf
sudo sshd -t && sudo systemctl reload ssh
```

Giữ phiên SSH hiện tại mở, mở một phiên mới bằng khoá deploy để chắc vẫn vào được, rồi mới
đóng phiên cũ. Khoá của từng dev thêm bằng `deploy/scripts/db-access.sh tunnel-add` ở mục B
"Thêm và xoá người". Kiểm tra từ máy dev:

```bash
ssh -N -i ~/.ssh/a2matex-dbtunnel -L 6379:127.0.0.1:6379 dbtunnel@<IP VPS> &
redis-cli -h 127.0.0.1 -a '<REDIS_PASSWORD>' --no-auth-warning ping      # PONG
ssh -i ~/.ssh/a2matex-dbtunnel dbtunnel@<IP VPS> id                       # phải bị từ chối
kill %1
```

## B. Vận hành

### Deploy

Merge vào `staging`. Không phải làm gì thêm. Theo dõi ở tab Actions. Nhánh `main` không còn tự deploy; muốn đưa `main` lên thì merge nó vào `staging`.

Mỗi lần deploy thay ba container chạy từ cùng một image: `a2matex-app` (API),
`a2matex-cron` (job định kỳ, xem `specs/005-separate-cron-server/`) và
`a2matex-consumer` (Kafka handler). Script chờ cả ba báo healthy; container nào không lên được
thì deploy thất bại và in 50 dòng log cuối của đúng container đó.

### Trước khi merge một migration vào staging

Chạy thử toàn bộ thư mục `prisma/migrations` trên một Postgres 17 tạm, vì migration viết tay có thể sai cú pháp mà Prisma không kiểm tra lúc tạo file. Ngày 2026-10-06 một dấu phẩy thừa đã làm deploy thất bại:

```bash
docker run -d --name pg-test -e POSTGRES_PASSWORD=t -e POSTGRES_DB=t postgres:17-alpine
sleep 5
for d in $(ls prisma/migrations | grep -v lock | sort); do
  docker exec -i pg-test psql -U postgres -d t -v ON_ERROR_STOP=1 -q < "prisma/migrations/$d/migration.sql" && echo "OK $d" || { echo "LỖI $d"; break; }
done
docker rm -f pg-test
```

### Sau khi thêm hoặc sửa route

Bắt buộc chạy lại seed permission, nếu không route mới trả 403 cho tất cả mọi người kể cả admin:

```bash
a2c --profile seed run --rm seed-permissions
```

Không chạy lại `seed-roles` trừ khi muốn đặt lại mật khẩu admin theo giá trị trong `.env.production`.

Script này cũng xóa cache phân quyền trong Redis. Guard đọc permission từ cache và cache không có hạn, nên nếu bỏ qua bước xóa thì route mới vẫn trả 403 dù database đã đúng. Khi cần xóa tay:

```bash
RP=$(grep -E '^REDIS_PASSWORD=' /opt/a2matex/.env.production | cut -d= -f2-)
for k in $(docker exec a2matex-redis redis-cli --no-auth-warning -a "$RP" --scan --pattern '*role_permissions*'); do
  docker exec a2matex-redis redis-cli --no-auth-warning -a "$RP" DEL "$k"
done
```

### Quay lui

1. Tìm tag muốn quay về. Mỗi lần deploy thành công in tag ở phần Summary của workflow, dạng `sha-1a2b3c4`. Hoặc xem danh sách ở trang Packages của org.
2. Vào tab Actions, chọn workflow Deploy, bấm Run workflow, điền tag vào ô `image_tag`, chạy.

Job build bị bỏ qua, job deploy kéo đúng tag đó về. Quay lui app không quay lui database.

### Xem trạng thái và log

```bash
a2c ps
a2c logs -f app
a2c logs -f cron                  # job định kỳ
a2c logs -f caddy
cat /opt/a2matex/.env.deploy      # tag đang chạy
```

Log của `cron` lúc khởi động liệt kê từng job: `[CronRunner] registered name=<job> schedule="<biểu thức>" source=<env|default> nextRun=<ISO>`; job bị tắt qua env hiện `disabled name=<job>`. Mỗi lần chạy có cặp dòng `started` / `finished ... durationMs=... outcome=success` (hoặc `failed ... outcome=error`, `skipped ... outcome=skipped` khi lần trước chưa xong). Muốn tắt tạm một job mà không deploy lại: đặt `CRON_<JOB>=off` trong `.env.production` rồi `a2c up -d cron`.

Log, CPU, số kết nối và truy vấn chậm của Postgres xem trong console Cloud SQL, trang instance
`a2matex-pg`, tab Logs và Query insights.

### Sao lưu và khôi phục

Cloud SQL tự sao lưu hằng ngày trong cửa sổ 03:00 sáng Việt Nam, giữ 7 bản, và lưu WAL để khôi
phục về bất kỳ thời điểm nào trong 7 ngày (point-in-time recovery). Không cần cron `pg_dump` trên
VPS nữa.

Trước một thao tác rủi ro, tạo bản sao lưu theo yêu cầu:

```bash
gcloud sql backups create --instance=a2matex-pg --description="truoc <viec sap lam>"
gcloud sql backups list --instance=a2matex-pg
```

Khôi phục: console SQL, instance `a2matex-pg`, tab Backups, chọn bản rồi Restore. Restore đè lên
instance làm app mất kết nối vài phút: `a2c stop app` trước, `a2c up -d app` sau. Muốn xem dữ liệu
tại một thời điểm mà không đụng instance đang chạy thì clone:

```bash
gcloud sql instances clone a2matex-pg a2matex-pg-recover --point-in-time='2026-10-20T02:30:00Z'
# xem xong thì xoá bản clone để khỏi tính tiền
gcloud sql instances delete a2matex-pg-recover
```

**Bản logical hằng tuần ra ngoài Google**, để không lệ thuộc một nhà cung cấp. Chạy từ VPS, đẩy
lên bucket R2. Cài `rclone` và cấu hình remote tên `r2` một lần bằng khoá R2 đang có trong
`.env.production` (`rclone config`, loại S3, provider Cloudflare):

```bash
sudo apt-get install -y rclone
mkdir -p /opt/a2matex/backups
crontab -e
```

```
0 4 * * 0 PGPASSWORD=$(grep -E '^POSTGRES_PASSWORD=' /opt/a2matex/.env.production | cut -d= -f2-) docker run --rm -e PGPASSWORD postgres:17-alpine pg_dump "postgresql://a2matex@<PRIVATE_IP>:5432/a2matex?sslmode=require" -Fc > /opt/a2matex/backups/db-$(date +\%F).dump && rclone copy /opt/a2matex/backups r2:<bucket>/db && find /opt/a2matex/backups -name 'db-*.dump' -mtime +28 -delete
```

Khôi phục bản logical vào một database rỗng (ví dụ khi dựng lại từ đầu) qua Auth Proxy trên
máy bạn:

```bash
pg_restore -h 127.0.0.1 -p 5433 -U a2matex -d a2matex --no-owner --no-acl db-2026-10-26.dump
```

### Vào Postgres từ máy bạn

Qua Cloud SQL Auth Proxy với tài khoản Google và role riêng, cài đặt một lần theo A10.1. Mỗi lần
làm việc:

```bash
cloud-sql-proxy --gcloud-auth --port 5433 a2matex-prod:asia-southeast1:a2matex-pg
psql "postgresql://<tên dev>@127.0.0.1:5433/a2matex"
```

Truy vấn nhanh không cần cài gì: Cloud SQL Studio trong console, đăng nhập bằng role riêng. Role
`a2matex` của app chỉ dùng cho app; `postgres` chỉ chủ repo dùng để quản trị. Trên VPS không còn
container Postgres; cần `psql` tại đó thì dùng image tạm như A5.6.

### Vào Redis từ máy bạn

Qua SSH tunnel lưu sẵn trong GUI, bằng khoá SSH riêng đã thêm ở mục "Thêm và xoá người":

- GUI (RedisInsight, Another Redis Desktop Manager, TablePlus): SSH host `<IP VPS>`, cổng
  22, user `dbtunnel`, private key của bạn; Redis host `127.0.0.1`, cổng 6379, mật khẩu là
  `REDIS_PASSWORD` trong `.env.production`. Lưu một lần, sau đó chỉ bấm kết nối.
- Dòng lệnh: `ssh -N -i ~/.ssh/a2matex-dbtunnel -L 6379:127.0.0.1:6379 dbtunnel@<IP VPS>`
  rồi `redis-cli -h 127.0.0.1 -a '<mật khẩu>'`.

User `dbtunnel` không có shell và chỉ forward được tới `127.0.0.1:6379`. Redis không nghe trên
IP public.

### Thêm và xoá người

**Postgres**: cấp role IAM và tạo role database theo A10.1. Thu hồi, lệnh đầu trong Cloud Shell,
phần SQL trong Cloud SQL Studio bằng user `postgres`:

```bash
gcloud projects remove-iam-policy-binding a2matex-prod \
  --member='user:<email>' --role='roles/cloudsql.client'
```

```sql
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '<tên dev>';
DROP OWNED BY "<tên dev>";
DROP ROLE "<tên dev>";
```

**Redis**: trên VPS, script `deploy/scripts/db-access.sh` quản lý khoá tunnel:

```bash
cd /opt/a2matex
deploy/scripts/db-access.sh tunnel-add <tên> "ssh-ed25519 AAAA... <tên>"
deploy/scripts/db-access.sh tunnel-list
deploy/scripts/db-access.sh tunnel-remove <tên>
```

Tên chỉ gồm a-z, 0-9, _, dài 3 tới 32. Dev tự tạo khoá cho tunnel:
`ssh-keygen -t ed25519 -f ~/.ssh/a2matex-dbtunnel -C <tên>` và gửi file `.pub`.

### Redis: phiên bản và vá lỗi

Mỗi deploy `compose pull` kéo `redis:7-alpine` mới và tạo lại container nếu image đổi, chấp nhận
để được vá tự động; Postgres do Cloud SQL vá trong cửa sổ bảo trì. Redis phải từ 7.4.6 trở lên (vá RediShell, tháng 10 năm
2025): không mở ra internet nhưng ai qua tunnel cũng là "đã đăng nhập" theo nghĩa của lỗi đó.

```bash
docker exec a2matex-redis redis-server --version
```

### Gỡ VM cũ sau khi thay máy

Máy cũ `a2matex-vps` (`34.87.57.207`) nằm trong project `robust-habitat-505713-b6` của **tài khoản
Google cũ**, không phải project hiện tại. Tài khoản đó đã hết credit nên Google sẽ tự tạm dừng tài
nguyên; không bắt buộc làm gì. Nếu muốn dọn hẳn, đăng nhập console bằng tài khoản cũ, Cloud Shell:

```bash
gcloud config set project robust-habitat-505713-b6
gcloud compute instances delete a2matex-vps --zone=asia-southeast1-b
gcloud compute addresses delete a2matex-ip --region=asia-southeast1
```

Dữ liệu Postgres cũ nằm trong volume Docker trên đĩa máy đó và mất theo; đây là chủ ý của lần
dựng lại 2026-10-20. Muốn giữ một bản thì dump trước khi xoá, nếu máy còn chạy:

```bash
ssh -i ~/.ssh/a2matex-deploy deploy@34.87.57.207 \
  'docker exec a2matex-postgres pg_dump -U a2matex -d a2matex -Fc' > ~/a2matex-old-$(date +%F).dump
```

Bản ghi DNS `db.a2matex.com` của spec 003 (nếu đã tạo) không còn dùng, xoá tại zonedns.vn.

## C. Sự cố thường gặp

| Triệu chứng | Nguyên nhân thường gặp | Xử lý |
| --- | --- | --- |
| Job deploy fail ở bước chờ healthy | biến môi trường sai hoặc migration lỗi | script đã in 50 dòng log cuối của migrate và app ngay trong Actions |
| App khởi động rồi thoát ngay | thiếu hoặc sai biến | `a2c logs app`, thông báo liệt kê đúng tên biến |
| Container `a2matex-cron` không healthy, khởi động lại liên tục | biểu thức cron trong một biến `CRON_*` sai, hoặc hai job trùng tên | `a2c logs cron`: dòng `[CronBootstrap]` nêu đúng tên biến và giá trị sai. Sửa `.env.production` rồi `a2c up -d cron`. API không bị ảnh hưởng bởi lỗi này |
| Mọi request trả 403 dù token hợp lệ | chưa seed permission cho route mới, hoặc cache phân quyền còn bản cũ | chạy `seed-permissions`, script tự xóa cache; nếu vẫn 403 thì xóa cache tay theo lệnh ở mục B |
| `curl` tên miền trả 502 | `HOST` trong env là `localhost`, hoặc app chưa lên | sửa `HOST=0.0.0.0`, `a2c logs app` |
| Caddy không xin được chứng chỉ | DNS chưa trỏ, hoặc cổng 80 bị chặn | `dig`, `ufw status`, `a2c logs caddy` |
| IP trong log là IP nội bộ Docker | `TRUST_PROXY` không phải `1` | sửa env, `a2c up -d app` |
| Job build fail 403 khi push image | workflow chưa có quyền ghi package | Settings, Actions, General, Read and write permissions |
| Job deploy fail ở rsync hoặc ssh | khóa hoặc user sai, hoặc thư mục chưa tồn tại | thử `ssh -i ~/.ssh/a2matex-deploy user@ip 'ls /opt/a2matex'` từ máy bạn |
| Job deploy fail ở bước Applying database migrations | SQL trong migration lỗi, thường là viết tay chưa chạy thử | app cũ vẫn chạy, không mất dịch vụ. Sửa file SQL, rồi trên máy ảo đánh dấu migration hỏng là đã hoàn tác: `IMAGE_TAG=<tag mới> a2c run --rm migrate npx prisma migrate resolve --rolled-back <tên migration> --config prisma7.config.ts`, sau đó push lại |
| `ssh deploy@ip` bị Permission denied trên Google Cloud | OS Login đang bật nên metadata ssh-keys bị bỏ qua | `gcloud compute instances add-metadata <VM> --metadata enable-oslogin=FALSE` |
| Tên miền không vào được dù `ufw` đã mở | thiếu firewall rule ở lớp VPC | xem lại lệnh tạo rule `a2matex-allow-web` ở A0 |
| Job deploy fail ở Applying database migrations với lỗi kết nối tới `10.x` (timeout, `ECONNREFUSED`) | Private Service Access chưa có, instance chưa bật Private IP, hoặc IP trong `DATABASE_URL` sai | `gcloud sql instances describe a2matex-pg`, xem lại A5.2 và A5.3. Job `migrate` phải nằm trên mạng `edge` trong compose vì mạng `backend` không có đường ra |
| App hoặc migrate báo `no pg_hba.conf entry ... no encryption` | thiếu `sslmode=require` trong `DATABASE_URL` | sửa env, `a2c up -d app` |
| App báo `self-signed certificate in certificate chain` | thiếu `uselibpqcompat=true` trong `DATABASE_URL`, driver `pg` xác minh chứng chỉ theo CA hệ thống | thêm tham số, `a2c up -d app` |
| `remaining connection slots are reserved` | `db-g1-small` giới hạn khoảng 50 kết nối; nhiều dev mở GUI cùng lúc | hạ `CONNECTION LIMIT` của role dev, hoặc nâng tier |
| Auth Proxy báo 403 hoặc `permission denied` | tài khoản Google chưa có `roles/cloudsql.client`, hoặc chưa `gcloud auth login` | xem A10.1 |
| Dev bị `password authentication failed` qua proxy | role chưa tạo hoặc sai mật khẩu | tạo lại role trong Cloud SQL Studio theo A10.1 |
