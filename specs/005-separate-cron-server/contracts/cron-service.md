# Contract: Dịch vụ job định kỳ (`src/cron/main.ts`)

Bốn giao diện mà dịch vụ job phơi ra cho người vận hành, hệ thống triển khai và lập trình
viên thêm job. Chi tiết quyết định xem `research.md`; cấu trúc dữ liệu xem `data-model.md`.

## 1. HTTP: endpoint health (FR-005)

Dịch vụ job lắng nghe `HOST:CRON_PORT` và chỉ phục vụ đúng một đường dẫn.

| | |
|---|---|
| Method / path | `GET /<API_PREFIX>/health` (mặc định `/api/v1/health`) |
| Xác thực | không (công khai, không phụ thuộc DB/Redis) |
| 200 body | `{ "status": "ok", "service": "cron", "uptime": <giây, số nguyên>, "timestamp": "<ISO 8601>" }` |
| Mọi đường dẫn khác | `404` (không có controller nào trong `CronModule`) |

Khác với API, body **không** được bọc `{ data, statusCode }` vì `CronModule` không đăng
ký `TransformInterceptor`. HEALTHCHECK chỉ cần mã 2xx (`curl -f`).

## 2. Biến môi trường (FR-004, FR-006, FR-007, FR-008)

Dịch vụ job đọc **cùng** `configSchema` với API (`src/shared/config.ts`); mọi biến kết
nối (`DATABASE_URL`, `REDIS_*`, `OBJECT_STORAGE_*`, `SEPAY_*`, …) dùng chung, không có bộ
thứ hai. Biến riêng của dịch vụ job:

| Biến | Bắt buộc | Mặc định | Giá trị | Hành vi |
|---|---|---|---|---|
| `CRON_PORT` | không | `3001` (`.env.example`: `9998`) | số cổng | cổng lắng nghe health; khác `PORT` của API |
| `CRON_SHUTDOWN_GRACE_SECONDS` | không | `30` | số nguyên ≥ 0 | thời gian tối đa chờ lần chạy dở khi nhận SIGTERM |
| `CRON_TOPUP_RECONCILE` | không | trống → `*/${SEPAY_RECONCILE_INTERVAL_MINUTES} * * * *` | biểu thức cron 5 trường, hoặc `off` | lịch job đối soát Sepay; `off` tắt job |
| `CRON_<JOB>` (job tương lai) | không | theo định nghĩa job | như trên | mỗi job mới thêm đúng một biến theo mẫu này |

Quy ước:
- Giá trị rỗng = không đặt (dùng mặc định), giống các biến optional khác trong schema.
- Biểu thức cron hợp lệ theo `cron` 4 (`validateCronExpression`): 5 trường
  `phút giờ ngày tháng thứ`, hỗ trợ `*/n`, danh sách, khoảng. Có thể dùng 6 trường (giây
  đứng đầu) vì `cron` 4 hỗ trợ, nhưng không khuyến khích.
- Biểu thức sai → tiến trình thoát mã 1 trong vài giây với dòng log mức error:
  `CRON_TOPUP_RECONCILE="<giá trị>" is not a valid cron expression: <lý do>`. API không bị
  ảnh hưởng vì kiểm tra nằm ở runner, không ở Zod.
- Đổi bất kỳ biến `CRON_*` nào đều cần khởi động lại dịch vụ job; không đọc lại lúc chạy.

## 3. Thêm job mới (FR-012) — giao diện cho lập trình viên

Ba bước, không đụng vào dịch vụ API:

1. Tạo `src/cron/jobs/<ten-job>.job.ts`:

   ```ts
   @Injectable()
   export class StaticUploadCleanupJob implements CronJobDefinition {
     readonly name = 'static-upload-cleanup';
     readonly envKey = 'CRON_STATIC_UPLOAD_CLEANUP';
     readonly schedule: string;
     readonly scheduleSource: 'env' | 'default';

     constructor(@Inject(StaticService) private readonly staticService: StaticService) {
       ({ schedule: this.schedule, scheduleSource: this.scheduleSource } = resolveCronSchedule(
         envConfig.CRON_STATIC_UPLOAD_CLEANUP,
         '0 * * * *',
       ));
     }

     async run(): Promise<void> {
       // phải idempotent (FR-014); lỗi ném ra được runner log, không cần try/catch toàn bộ
     }
   }
   ```

2. Thêm biến `CRON_STATIC_UPLOAD_CLEANUP` vào `configSchema`
   (`z.string().optional().transform(emptyToUndefined)`) và vào `.env.example`,
   `.env.production.example` kèm một dòng chú thích.
3. Đăng ký trong `src/cron/cron.module.ts`: thêm class vào `providers` và vào `inject` của
   multi-provider `CRON_JOBS`. Nếu job cần service của một route module, import module
   **không có controller** (vd `TopUpCoreModule`); không import module có controller.

Cam kết của runner với mọi job: validate lịch lúc khởi động, tôn trọng `off`, log
start/end/duration/outcome, không chạy chồng, bắt lỗi, drain khi shutdown. Job không cần
tự làm các việc này.

## 4. Tiến trình, tín hiệu, mã thoát (FR-015, FR-017)

| Tình huống | Hành vi | Mã thoát |
|---|---|---|
| Thiếu biến bắt buộc trong `configSchema` | in lỗi Zod (như API), thoát ngay | 1 |
| Tên job trùng / biểu thức cron sai | log error nêu `envKey` và giá trị, thoát | 1 |
| Redis/DB chưa sẵn sàng lúc khởi động | khởi động thất bại như API; `restart: unless-stopped` khởi động lại | 1 |
| SIGTERM / SIGINT | ngừng tick mới, chờ lần chạy dở ≤ `CRON_SHUTDOWN_GRACE_SECONDS`, đóng Redis/Prisma, thoát | 0 (quá ân hạn vẫn 0, có log warn) |

## 5. Hợp đồng triển khai (`deploy/`)

| Mục | Giá trị |
|---|---|
| Compose service / container | `cron` / `a2matex-cron` |
| Image | cùng `*app-image` với `app` (cùng `IMAGE_TAG`) |
| Command | `node dist/cron/main.js` |
| Env | `env_file: ../.env.production` (chung với `app`) + `environment: CRON_PORT: ${CRON_PORT:-9998}` để cổng tiến trình luôn khớp healthcheck dù `.env.production` chưa đặt biến |
| Mạng | `backend` + `edge` (tới Cloud SQL qua VPC); **không** `ports`, không route Caddy |
| depends_on | `redis: service_healthy`, `migrate: service_completed_successfully` |
| healthcheck | `curl -fsS http://127.0.0.1:${CRON_PORT:-9998}/${API_PREFIX:-api/v1}/health`; interval 30s, timeout 5s, start_period 20s, retries 3 |
| stop_grace_period | `45s` (> `CRON_SHUTDOWN_GRACE_SECONDS` mặc định 30) |
| Deploy script | `deploy/vps-deploy.sh` chờ `healthy` cho cả `a2matex-app` và `a2matex-cron` trong `HEALTH_TIMEOUT` (120s); thất bại → in `docker logs --tail 50` của container đó, `exit 1` |
| Local | `npm run start:cron:dev` (watch) / `npm run start:cron`; prod `npm run start:cron:prod` |
