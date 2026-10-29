# Implementation Plan: Tách job định kỳ ra dịch vụ riêng

**Branch**: `ffeature/separate-cron-server` | **Date**: 2026-10-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-separate-cron-server/spec.md`

## Summary

Job định kỳ (hiện chỉ có đối soát Sepay trong `src/routes/topup/topup.cron.ts`) chuyển
sang một tiến trình riêng `src/cron/main.ts` bootstrap `CronModule`, lắng nghe trên
`CRON_PORT` và chỉ phục vụ `GET /<API_PREFIX>/health`. Dịch vụ job dùng chung
`SharedModule` (Prisma, Redis, S3, email) và cùng Docker image với API; prod thêm service
`cron` trong `deploy/docker-compose.prod.yaml` chạy `node dist/cron/main.js`. Mỗi job là
một class implement `CronJobDefinition` (tên, biến env lịch, lịch đã resolve, `run()`),
được gom vào multi-provider `CRON_JOBS`; `CronRunner` đọc danh sách lúc bootstrap, kiểm
tra biểu thức cron (từ chối khởi động nếu sai, nêu tên biến), bỏ qua job đặt `off`, đăng
ký vào `SchedulerRegistry` của `@nestjs/schedule`, log từng lần chạy, chặn chạy chồng và
drain lần chạy dở khi nhận SIGTERM. API bỏ `ScheduleModule.forRoot()` và không còn job.
`TopUpModule` tách thành `TopUpCoreModule` (service, repo, Sepay client, có export) và
`TopUpModule` (controller + webhook guard) để cron import được service mà không kéo
controller vào cổng cron. Lịch chỉ qua biến môi trường (research.md §3); không DB, không
queue, một instance (Nguyên tắc VI).

## Technical Context

**Language/Version**: TypeScript (Node.js ≥ 22, image `node:24-bookworm-slim`), NestJS 11
(ESM, `tsx` cho dev, `tsc` build thuần ra `dist/`)

**Primary Dependencies**: `@nestjs/*` 11, `@nestjs/schedule` 12.0.2 (đã có; dùng
`ScheduleModule` + `SchedulerRegistry`), `cron` 4.4.0 (hiện là dependency bắc cầu của
`@nestjs/schedule`; **khai báo tường minh** vào `package.json` vì code gọi trực tiếp
`CronJob`, `validateCronExpression` — research.md §2), Prisma 7, `redis`, `zod` 4 (config).
Không thêm queue/worker library.

**Storage**: không đổi schema; không migration. Dịch vụ job dùng cùng `DATABASE_URL`,
Redis, object storage với API qua `SharedModule`.

**Testing**: Vitest — unit test co-located trong `src/cron/test/*.spec.ts` (runner, job
đối soát, resolve lịch) không cần DB/Redis; e2e `test/cron.e2e-spec.ts` theo pattern
`test/app.e2e-spec.ts` (cần Redis/DB như e2e hiện có) kiểm tra health route và việc không
có route nghiệp vụ nào trên cổng cron.

**Target Platform**: Linux container trên VPS hiện có (`specs/001-vps-deployment`,
`specs/004-cloud-sql-postgres`): thêm 1 container `a2matex-cron` cùng image với
`a2matex-app`, join `backend` + `edge`, không publish port, không có route Caddy.

**Project Type**: Web service (NestJS REST API) + 1 entry point thứ hai cho job định kỳ
trong cùng package; không monorepo.

**Performance Goals**: không có job nào chạy trong tiến trình API (SC-001); job đối soát
Sepay giữ chu kỳ mặc định 15 phút (FR-013); dịch vụ job báo khỏe trong `HEALTH_TIMEOUT`
120 giây hiện có của `deploy/vps-deploy.sh` (SC-006); phát hiện biểu thức cron sai trong
10 giây khi khởi động (SC-004).

**Constraints**: cổng cron chỉ nội bộ (FR-016); endpoint health KHÔNG được nằm trong file
`*controller.ts` vì `src/seed/create-permissions.ts` quét đệ quy toàn bộ `src/` và sẽ tạo
Permission record cho nó (research.md §1); không được import `TopUpModule` (có controller)
vào `CronModule`; biểu thức cron sai chỉ được làm dịch vụ job từ chối khởi động, không
được kéo API xuống theo (research.md §3); `stop_grace_period` của container cron phải lớn
hơn `CRON_SHUTDOWN_GRACE_SECONDS` (FR-017).

**Scale/Scope**: 1 entry point mới + 1 module mới (`src/cron/`, ~6 file nguồn + test), 1
job chuyển sang (đối soát Sepay), 1 module tách (`TopUpCoreModule`), 3 biến env mới
(`CRON_PORT`, `CRON_SHUTDOWN_GRACE_SECONDS`, `CRON_TOPUP_RECONCILE`), 3 npm script mới, 1
compose service + sửa deploy script, cập nhật README/runbook/env example. Job dọn dẹp
upload presigned nằm ngoài phạm vi (spec Assumptions).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Nguyên tắc | Đánh giá |
|---|---|
| I. Schema-Validated Boundaries | PASS — `CRON_PORT`, `CRON_SHUTDOWN_GRACE_SECONDS`, `CRON_TOPUP_RECONCILE` thêm vào `configSchema` (`src/shared/config.ts`), rỗng → `undefined` như các biến optional hiện có. Cú pháp biểu thức cron được kiểm tra ở `CronRunner` lúc bootstrap (không trong Zod) để API không bị chặn khởi động vì lỗi cấu hình của riêng cron (research.md §3); vẫn là fail-fast, thông báo nêu tên biến và giá trị (FR-007). |
| II. Permission-Gated Routes | PASS — không thêm route API nào. `GET /health` trên cổng cron là health-check công khai, không phụ thuộc DB, nằm trong ngoại lệ của nguyên tắc; đăng ký trực tiếp trên HTTP adapter, không qua controller, nên seed permission không quét tới (research.md §1). Không cần chạy lại `seed:permissions`. |
| III. Migration Discipline | PASS — không đổi `schema.prisma`, không migration. |
| IV. Quality Gates Before Deploy | PASS — pipeline `.github/workflows/deploy.yml` không đổi; `lint`/`test`/`build` vẫn gate; `npm run build` phải sinh `dist/cron/main.js` (tsconfig.build include `src` nên tự có). Image vẫn tag theo SHA, 1 image cho cả hai service. |
| V. Explicit Decision Gates for Infrastructure | PASS — thay đổi compose/deploy script nằm trong spec này; hướng kỹ thuật được chủ repo chốt 2026-10-27 (spec Assumptions). Không đổi reverse proxy, hosting, CI. |
| VI. Simplicity / YAGNI | PASS — không BullMQ, không bảng lịch, không khóa phân tán mới (một instance; FR-014 yêu cầu job idempotent, job Sepay đã có unique constraint + `@DistributedLock`). Abstraction duy nhất là interface `CronJobDefinition` + `CronRunner`, cần để đáp ứng FR-007…FR-011 đồng nhất cho mọi job thay vì lặp lại trong từng job. `cron` khai báo tường minh chỉ vì code import trực tiếp, không phải dependency mới về bản chất. Tách `TopUpCoreModule` là cách nhỏ nhất để cron dùng service mà không kéo controller. |

Không có vi phạm cần ghi vào Complexity Tracking.

**Re-check sau Phase 1 (research.md, data-model.md, contracts/, quickstart.md)**: không phát
sinh vi phạm mới. Data model chỉ là cấu trúc trong bộ nhớ (không entity DB), contract chỉ
gồm health endpoint + biến env + interface job + hợp đồng compose/deploy; không route mới
thiếu permission, không migration. Giữ nguyên PASS toàn bộ.

## Project Structure

### Documentation (this feature)

```text
specs/005-separate-cron-server/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── cron-service.md  # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

`src/cron/` nằm ngoài `src/routes/` vì không phải HTTP route module (quy ước `nest g ...
routes/<name>` trong README chỉ áp cho route module). Mọi job tập trung trong
`src/cron/jobs/` để "hệ thống có những job nào" nhìn một chỗ là thấy (spec Key Entities).

```text
src/
├── main.ts                                # SỬA: không đổi logic; AppModule không còn job
├── app.module.ts                          # SỬA: bỏ ScheduleModule.forRoot()
├── cron/                                  # MỚI
│   ├── main.ts                            # bootstrap CronModule, registerCronHealthRoute,
│   │                                      #   enableShutdownHooks, listen CRON_PORT; lỗi
│   │                                      #   bootstrap → log + exit 1
│   ├── cron.module.ts                     # ScheduleModule.forRoot(), SharedModule,
│   │                                      #   TopUpCoreModule; providers: CronRunner,
│   │                                      #   các job, multi-provider CRON_JOBS (danh sách
│   │                                      #   job duy nhất — FR-012)
│   ├── cron-health.ts                     # registerCronHealthRoute(app): GET
│   │                                      #   /<API_PREFIX>/health trên HTTP adapter
│   │                                      #   (KHÔNG phải *controller.ts — research §1)
│   ├── cron-job.interface.ts              # CRON_JOBS token, CRON_SCHEDULE_OFF, interface
│   │                                      #   CronJobDefinition, resolveCronSchedule()
│   ├── cron-runner.service.ts             # CronRunner: validate, đăng ký vào
│   │                                      #   SchedulerRegistry, log, chặn chạy chồng,
│   │                                      #   drain trong onModuleDestroy (FR-007…FR-011, FR-017; research.md §2)
│   ├── jobs/
│   │   └── topup-reconcile.job.ts         # chuyển từ routes/topup/topup.cron.ts (FR-013)
│   └── test/
│       ├── cron-runner.service.spec.ts
│       ├── cron-job.interface.spec.ts     # resolveCronSchedule: env / default / off
│       └── topup-reconcile.job.spec.ts
├── routes/topup/
│   ├── topup-core.module.ts               # MỚI: TopUpService, TopUpRepo, SepayApiClient;
│   │                                      #   exports TopUpService, SepayApiClient
│   ├── topup.module.ts                    # SỬA: imports TopUpCoreModule; chỉ còn
│   │                                      #   controller + SepayWebhookGuard
│   └── topup.cron.ts                      # XOÁ (thay bằng cron/jobs/topup-reconcile.job.ts)
└── shared/
    └── config.ts                          # SỬA: + CRON_PORT, CRON_SHUTDOWN_GRACE_SECONDS,
                                           #   CRON_TOPUP_RECONCILE

test/
└── cron.e2e-spec.ts                       # MỚI: health 200 trên CronModule app; route
                                           #   nghiệp vụ (vd POST /topups) → 404

package.json                               # SỬA: scripts start:cron, start:cron:dev,
                                           #   start:cron:prod; dependency "cron": "^4.4.0"
.env.example                               # SỬA: CRON_PORT=9998, CRON_SHUTDOWN_GRACE_SECONDS,
.env.production.example                    #   CRON_TOPUP_RECONCILE (+ chú thích "off")
deploy/
├── docker-compose.prod.yaml               # SỬA: + service cron (a2matex-cron), healthcheck
│                                          #   riêng theo CRON_PORT, stop_grace_period 45s,
│                                          #   không ports, depends_on redis + migrate
└── vps-deploy.sh                          # SỬA: chờ healthy cả a2matex-app lẫn a2matex-cron
Dockerfile                                 # SỬA: chỉ comment đầu file (thêm vai trò cron)
README.md                                  # SỬA: "Phát triển cục bộ" + mục "Job định kỳ"
docs/deployment-runbook.md                 # SỬA: B. "Xem trạng thái và log" thêm a2matex-cron
```

**Structure Decision**: Single project (NestJS backend) với hai entry point `src/main.ts`
(API) và `src/cron/main.ts` (job), cùng `tsc` build, cùng image; không chuyển sang Nest
monorepo (`nest-cli.json` projects) hay package riêng — đã loại khi chốt hướng (spec
Assumptions, research.md §6).

## Complexity Tracking

Không có vi phạm constitution cần biện minh.
