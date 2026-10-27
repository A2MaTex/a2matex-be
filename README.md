# a2matex-be

Backend API cho A2MaTeX: NestJS 11, Prisma 7 (PostgreSQL), Redis, Zod.

## Tài liệu triển khai

| Tài liệu                                                 | Dùng khi                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [docs/deployment-spec.md](docs/deployment-spec.md)       | muốn hiểu kiến trúc, quyết định và những gì đã kiểm chứng                          |
| [docs/deployment-runbook.md](docs/deployment-runbook.md) | cần thao tác thật trên VPS và GitHub: thiết lập lần đầu, deploy, quay lui, sao lưu |

Deploy là tự động: merge vào `staging` sẽ build image, đẩy lên GHCR và cập nhật VPS qua workflow `.github/workflows/deploy.yml`.

Tài liệu API (Swagger UI) nằm tại `/api/v1/docs` trên mọi môi trường, bản JSON tại `/api/v1/docs-json`.

## Phát triển cục bộ

```bash
npm install
cp .env.example .env            # rồi điền giá trị
npm run compose-up              # postgres + redis
npm run prisma:generate
npm run prisma:migrate:deploy
npm run seed:roles
npm run seed:permissions
npm run start:dev                # API trên PORT (9999)
npm run start:cron:dev           # job định kỳ trên CRON_PORT (9998), terminal thứ hai
```

API và cron service đọc cùng một `.env`; hai cổng mặc định khác nhau nên chạy song song
được mà không sửa thêm biến nào.

## Job định kỳ (cron service)

Job định kỳ không chạy trong tiến trình API. Chúng chạy trong một tiến trình riêng
(`src/cron/main.ts`, prod là container `a2matex-cron`) dùng chung code, Prisma, Redis và
object storage với API, chỉ mở `GET /api/v1/health` trên `CRON_PORT`. Chi tiết:
`specs/005-separate-cron-server/`.

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `CRON_PORT` | `3001` (`.env.example`: `9998`) | cổng health của cron service |
| `CRON_SHUTDOWN_GRACE_SECONDS` | `30` | thời gian chờ job đang chạy dở khi nhận SIGTERM |
| `CRON_TOPUP_RECONCILE` | trống = `*/<SEPAY_RECONCILE_INTERVAL_MINUTES> * * * *` | lịch job đối soát Sepay; `off` tắt job |

Lịch chỉ đọc từ biến môi trường lúc khởi động (biểu thức cron 5 trường). Biểu thức sai
làm cron service thoát ngay với thông báo nêu đúng tên biến; API không bị ảnh hưởng.

### Thêm một job mới

1. Tạo `src/cron/jobs/<ten-job>.job.ts`: class `@Injectable()` implement
   `CronJobDefinition` (`src/cron/cron-job.interface.ts`) với `name` duy nhất, `envKey`
   dạng `CRON_<JOB>`, lịch lấy qua `resolveCronSchedule(envConfig.CRON_<JOB>, '<mặc định>')`
   và `run()`. `run()` phải an toàn khi chạy lặp (không có khóa phân tán).
2. Thêm `CRON_<JOB>: z.string().optional().transform(emptyToUndefined)` vào `configSchema`
   trong `src/shared/config.ts`, và một dòng vào `.env.example`, `.env.production.example`.
3. Đăng ký trong `src/cron/cron.module.ts`: thêm class vào `providers` và vào `inject`
   của multi-provider `CRON_JOBS`. Nếu job cần service của một route module, import
   module **không có controller** (ví dụ `TopUpCoreModule`), vì controller của module
   được import sẽ mở route trên cổng cron.

Runner (`CronRunner`) tự lo: kiểm tra biểu thức lúc khởi động, tôn trọng `off`, log
start/finish/thời lượng/kết quả, không chạy chồng cùng một job, bắt lỗi và chờ job
đang dở khi dừng. Job không cần tự làm các việc này. Không cần chạy lại
`seed:permissions` khi thêm job.

## Tools

### Docker

Start the docker container with predefined env

```bash
docker compose --env-file .env -f tools/docker-compose.yaml up -d
```

## Prisma

### Migration steps

1. Create migration file with prisma

```bash
npx prisma migrate dev --create-only --config prisma7.config.ts
```

2. Apply migration to the database

```bash
npx prisma migrate deploy --config prisma7.config.ts
```

3. Update schema.prisma from the actual DB

```bash
npx prisma db pull --config prisma7.config.ts
```

4. Generate Prisma Client

```bash
npx prisma generate --config prisma7.config.ts
```

5. Other

Mark a failed migration as rolled-back before retrying

```bash
npx prisma migrate resolve \
  --rolled-back 20261005015649_add_static_storage \
  --config prisma7.config.ts
```

Verify the checksum of modified migration

```bash
sha256sum prisma/migrations/20261005015649_add_static_storage/migration.sql
```

## NestJS

### Start a new module

Generate core files

```bash
npx nest g module routes/<module_name> --no-spec
npx nest g controller routes/<module_name> --no-spec
npx nest g service routes/<module_name> --no-spec
```

Flags meaning

```bash
--dry-run       # show what the command would do
--no-spec       # do not create .spec.ts files
--spec          # force spec files
--flat          # generate without nested folder
--no-flat       # generate folder structure
--skip-import   # do not auto-import into module
--format        # run prettier on generated files
```

## Seed initial data

### Create roles

```bash
npx tsx src/seed/create-role.ts
```

### Create permissions

```bash
npx tsx src/seed/create-permissions.ts
```

### Sync node catalog

```bash
npx tsx src/seed/sync-node-catalog.ts
```
