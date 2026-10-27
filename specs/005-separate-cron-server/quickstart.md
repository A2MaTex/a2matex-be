# Quickstart: Tách job định kỳ ra dịch vụ riêng

Validate end-to-end sau khi implement, theo User Story 1–3 của `spec.md` và
`contracts/cron-service.md`. Mọi lệnh chạy từ thư mục gốc repo.

## Chuẩn bị

1. Dev cục bộ theo đúng thứ tự README (`npm install` → `.env` → `npm run compose-up` →
   `npm run prisma:generate` → `npm run prisma:migrate:deploy` → `npm run seed:roles` →
   `npm run seed:permissions`).
2. Trong `.env` có (xem `contracts/cron-service.md` §2):
   ```dotenv
   PORT=9999
   CRON_PORT=9998
   CRON_SHUTDOWN_GRACE_SECONDS=30
   CRON_TOPUP_RECONCILE=          # trống = */15 * * * * theo SEPAY_RECONCILE_INTERVAL_MINUTES
   ```
   `SEPAY_API_BASE_URL`/`SEPAY_API_TOKEN` có thể để trống: job đối soát sẽ log lỗi gọi
   Sepay nhưng dịch vụ job vẫn sống (đúng FR-010) — đủ để kiểm tra điều phối.
3. Hai terminal: `npm run start:dev` (API) và `npm run start:cron:dev` (job).

## Scenario 1 — Hai dịch vụ, hai cổng, API không chạy job (User Story 1)

```bash
curl -s http://localhost:9999/api/v1/health        # API: { "data": { "status": "ok", ... }, "statusCode": 200 }
curl -s http://localhost:9998/api/v1/health        # cron: { "status": "ok", "service": "cron", ... }
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:9998/api/v1/topups   # 404
```

**Kỳ vọng**: log khởi động của terminal cron có dòng `CronRunner` liệt kê
`topup-reconcile` với `schedule=*/15 * * * *`, `source=default`, `nextRun=<ISO>`. Log của
terminal API **không** có context `CronRunner` hay `TopUpCron`. Đặt tạm
`CRON_TOPUP_RECONCILE="* * * * *"` rồi khởi động lại cron: mỗi phút thấy cặp dòng
"started"/"finished" (hoặc "failed" nếu chưa có token Sepay) chỉ ở terminal cron. Tắt
terminal cron, gọi lại API: vẫn 200. Tắt API, chờ 1 phút: cron vẫn tick. Khớp Acceptance
Scenario 1–5 của Story 1, SC-001, SC-005.

## Scenario 2 — Lịch qua env, sai cú pháp bị từ chối, `off` tắt job (User Story 2)

```bash
CRON_TOPUP_RECONCILE="*/5 * * * *" npm run start:cron     # log: source=env, schedule=*/5 * * * *
CRON_TOPUP_RECONCILE="every 5 minutes" npm run start:cron # thoát mã 1 trong vài giây, log error
                                                          # nêu CRON_TOPUP_RECONCILE="every 5 minutes"
echo $?                                                   # 1
CRON_TOPUP_RECONCILE=off npm run start:cron               # log: topup-reconcile disabled (CRON_TOPUP_RECONCILE=off)
```

**Kỳ vọng**: ba hành vi trên khớp Acceptance Scenario 2–4 của Story 2 và SC-004. Terminal
API đang chạy không bị ảnh hưởng bởi giá trị sai (research.md §3).

## Scenario 3 — Chặn chạy chồng và cô lập lỗi (User Story 2, FR-010, FR-011)

Dùng unit test thay vì chờ job thật:

```bash
npm test -- src/cron
```

**Kỳ vọng**: `cron-runner.service.spec.ts` xanh với các case: tên trùng → throw; biểu
thức sai → throw chứa `envKey`; `off` → không đăng ký; tick khi đang chạy dở → bỏ qua và
log warn; job ném lỗi → runner không ném, job khác vẫn chạy; shutdown chờ in-flight ≤ ân
hạn. `topup-reconcile.job.spec.ts`: một giao dịch lỗi không chặn giao dịch sau. Khớp
Acceptance Scenario 5–6 của Story 2.

## Scenario 4 — Dừng an toàn (User Story 3, FR-017)

1. Đặt `CRON_TOPUP_RECONCILE="* * * * *"` và `CRON_SHUTDOWN_GRACE_SECONDS=30`, chạy
   `npm run start:cron`.
2. Ngay sau dòng "started" của một lần chạy, gửi `Ctrl+C` (SIGINT) hoặc
   `kill -TERM <pid>`.

**Kỳ vọng**: log "shutdown: waiting for 1 in-flight job", rồi "finished" của job, rồi
tiến trình thoát mã 0; không có tick mới sau tín hiệu dừng. Đặt
`CRON_SHUTDOWN_GRACE_SECONDS=0` lặp lại: thoát ngay với log warn "grace period exceeded".
Khớp Acceptance Scenario 3 của Story 3, SC-007.

## Scenario 5 — Build và e2e

```bash
npm run lint && npm test && npm run build
ls dist/cron/main.js                 # phải tồn tại
npm run start:cron:prod &            # chạy từ dist, health 200 trên CRON_PORT
npm run test:e2e -- test/cron        # cần Redis/DB như test/app.e2e-spec.ts
```

**Kỳ vọng**: lint/test/build xanh (Nguyên tắc IV); `test/cron.e2e-spec.ts` xác nhận
health 200 và `POST /api/v1/topups` → 404 trên app dựng từ `CronModule`.

## Scenario 6 — Triển khai (User Story 3, FR-015, FR-016)

Trên VPS sau khi merge vào `staging` (CI tự deploy) hoặc chạy tay
`deploy/vps-deploy.sh`:

```bash
docker compose --env-file .env.production --env-file .env.deploy -f deploy/docker-compose.prod.yaml ps
# a2matex-app và a2matex-cron cùng IMAGE_TAG, cả hai (healthy)
docker inspect --format '{{.Config.Image}}' a2matex-app a2matex-cron     # giống nhau
docker logs --tail 20 a2matex-cron                                         # dòng CronRunner liệt kê job
docker exec a2matex-cron curl -fsS http://127.0.0.1:9998/api/v1/health    # 200
curl -s -o /dev/null -w '%{http_code}\n' https://<APP_DOMAIN>:9998/        # không kết nối được (port không publish)
docker exec a2matex-app curl -fsS http://127.0.0.1:9999/api/v1/health      # app vẫn khỏe
```

**Kỳ vọng**: khớp Acceptance Scenario 1, 2, 5 của Story 3 và SC-006. Kiểm tra thất bại có
chủ đích: đặt `CRON_TOPUP_RECONCILE=bad` trong `.env.production`, deploy lại → script in
`docker logs --tail 50 a2matex-cron` và `exit 1`; `a2matex-app` cũ vẫn phục vụ. Trả lại
giá trị đúng và deploy lại.
