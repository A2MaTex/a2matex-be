# Research: Tách job định kỳ ra dịch vụ riêng

**Input**: `specs/005-separate-cron-server/spec.md` (FR-001…FR-019, SC-001…SC-007)

Mục tiêu: chốt các quyết định kỹ thuật trước khi thiết kế contract/quickstart, dựa trên
code hiện có (`src/main.ts`, `src/app.module.ts`, `src/routes/topup/*`,
`src/shared/config.ts`, `src/seed/create-permissions.ts`, `deploy/*`) và API thực tế của
các package đã cài (`@nestjs/schedule` 12.0.2, `cron` 4.4.0, `@nestjs/core` 11).

## 1. Cách bootstrap dịch vụ job và endpoint health (FR-001, FR-005)

**Decision**: `src/cron/main.ts` dùng `NestFactory.create<NestExpressApplication>(CronModule)`
như `src/main.ts`, gọi `app.enableShutdownHooks()`, rồi `app.listen(CRON_PORT, HOST)`.
Endpoint health đăng ký **trực tiếp trên HTTP adapter** qua helper
`registerCronHealthRoute(app)` trong `src/cron/cron-health.ts`
(`app.getHttpAdapter().get(`${API_PREFIX_PATH}/health`, handler)`), trả JSON thuần
`{ status: 'ok', service: 'cron', uptime, timestamp }`. `CronModule` không khai báo
controller nào, nên mọi đường dẫn khác trả 404.

**Rationale**:
- `src/seed/create-permissions.ts` quét đệ quy **toàn bộ `src/`** lấy mọi file có tên kết
  thúc bằng `controller.ts` (hàm `getControllerFiles(sourceRoot)`) và tạo Permission record
  cho từng route. Một `src/cron/cron.controller.ts` sẽ bị quét, sinh thêm record
  `GET /api/v1/health` trùng với `AppController` và kéo Nguyên tắc II vào một endpoint
  nội bộ không cần quyền. Đăng ký trên adapter (cách Swagger đang làm trong `main.ts`)
  tránh hẳn vấn đề này mà không phải sửa seed.
- Dùng `NestFactory.create` (thay vì `createApplicationContext` + `node:http`) giữ đúng
  một cách bootstrap/listen/shutdown trong repo; Nest tự đóng HTTP server khi `app.close()`.
- Global prefix không áp cho route đăng ký trên adapter, nên helper tự ghép
  `API_PREFIX_PATH` để cùng đường dẫn `/api/v1/health` với API; HEALTHCHECK dùng lại được
  `${API_PREFIX:-api/v1}/health`.
- Không có `APP_GUARD`/`APP_INTERCEPTOR` trong `CronModule`, nên health công khai và
  không bị bọc `{ data, statusCode }` như API (ghi trong contract).

**Alternatives considered**:
- Controller trong `src/cron/` với tên file khác đuôi `controller.ts`: tránh seed bằng
  quy ước đặt tên, dễ vỡ khi ai đó đổi tên file.
- Sửa seed để chỉ quét `src/routes/` + `src/app.controller.ts`: đúng nhưng mở rộng phạm
  vi sang seed, không cần cho tính năng này.
- `createApplicationContext` + server `node:http` riêng: gọn hơn một chút nhưng phải tự
  quản lý listen/close và là cách thứ hai để chạy app trong repo.

## 2. Cách đăng ký và điều phối job (FR-006…FR-012, FR-017)

**Decision**: Mỗi job là một `@Injectable()` class implement interface
`CronJobDefinition` (`src/cron/cron-job.interface.ts`):

| Thuộc tính | Ý nghĩa |
|---|---|
| `name` | định danh duy nhất, kebab-case, dùng cho log và `SchedulerRegistry` |
| `envKey` | tên biến môi trường ghi đè lịch (chỉ để thông báo lỗi/log) |
| `schedule` | biểu thức cron đã resolve (env hoặc mặc định) hoặc `'off'` |
| `scheduleSource` | `'env'` hay `'default'`, để log lúc khởi động (FR-009) |
| `run()` | việc cần làm, trả `Promise<void>` |

Job gọi helper `resolveCronSchedule(envConfig[envKey], DEFAULT)` để điền `schedule` và
`scheduleSource`; `envKey` là thuộc tính tĩnh của job. `CronModule` gom job bằng multi-provider token `CRON_JOBS`
(`useFactory: (...jobs) => jobs, inject: [TopUpReconcileJob, ...]`) — đây là **danh sách
job duy nhất** (FR-012). `CronRunner` (`src/cron/cron-runner.service.ts`):

- `onApplicationBootstrap()`: với từng job — từ chối tên trùng; nếu `schedule === 'off'`
  log "disabled" và bỏ qua (FR-008); gọi `validateCronExpression(schedule)` của `cron`,
  sai thì `throw new Error(`${envKey}="${schedule}" is not a valid cron expression: ...`)`
  (FR-007); tạo `new CronJob(schedule, () => this.execute(job), null, false)`, đăng ký
  `schedulerRegistry.addCronJob(name, job)`, `start()`, log tên + lịch + nguồn +
  `nextDate().toISO()` (FR-009).
- `execute(job)`: nếu `inFlight` đã có `name` → log warn "skipped: previous run still in
  progress" (FR-011); ngược lại ghi thời điểm, `await job.run()`, log thành công/lỗi kèm
  thời lượng ms (FR-010); lỗi được bắt trong runner nên không rơi ra ngoài tick.
- `onModuleDestroy()` (**không** phải `beforeApplicationShutdown` như dự kiến ban đầu):
  `stop()` mọi `CronJob` runner đang giữ (không tick mới), rồi
  `Promise.race([Promise.allSettled(inFlight), sleep(CRON_SHUTDOWN_GRACE_SECONDS)])`; quá
  ân hạn thì log warn và thoát (FR-017). Lý do đổi hook, kiểm chứng trong
  `@nestjs/core/nest-application-context.js`: `app.close()` chạy **toàn bộ**
  `onModuleDestroy` (module gốc trước, module import sau) rồi mới tới
  `beforeApplicationShutdown`; `RedisCacheProvider` của `SharedModule` ngắt Redis trong
  `onModuleDestroy`. Drain ở `beforeApplicationShutdown` sẽ chạy sau khi Redis đã đóng,
  job dở dùng `@DistributedLock` sẽ lỗi. Drain ở `onModuleDestroy` của module gốc chạy
  trước Redis/Prisma đóng. `SchedulerOrchestrator.beforeApplicationShutdown` của
  `@nestjs/schedule` vẫn gọi `closeCronJobs()` sau đó, vô hại.
- Lỗi trong `onApplicationBootstrap` làm `app.listen()` reject; `main.ts` bắt, log bằng
  `Logger.error` và `process.exit(1)` (SC-004).

**Rationale**: cần một chỗ duy nhất để áp FR-007…FR-011 cho mọi job (validate, off, log,
chặn chạy chồng, drain). Decorator `@Cron()` của `@nestjs/schedule` không cho validate
trước khi mount (biểu thức sai ném lỗi từ `SchedulerOrchestrator.mountCron` với stack
trace, không nêu tên biến), không có cơ chế "off" theo env, không log lần chạy/thời
lượng, và `ScheduleModule` không chặn chạy chồng. `SchedulerRegistry` vẫn được dùng để
Nest tự `stop()` job khi shutdown và để job nhìn thấy được qua một registry chuẩn.
`cron` 4.4.0 có sẵn `validateCronExpression`, `CronJob.nextDate()`, `stop()`.

**Alternatives considered**:
- `@Cron(envConfig.X, { name })` trên từng class: ít code hơn nhưng không đạt FR-007
  (thông báo nêu tên biến), FR-008 (off), FR-010/FR-011 đồng nhất.
- Dùng `waitForCompletion: true` của `cron` 4 thay cho `inFlight` tự quản: chặn chạy
  chồng nhưng **bỏ qua im lặng**, không log được lần bị bỏ (FR-011 yêu cầu log); giữ
  guard tự viết (~10 dòng).
- BullMQ repeatable jobs: lịch lưu trong Redis, trái yêu cầu "chỉ env"; đã loại ở spec.

**Dependency**: `cron` hiện chỉ là dependency bắc cầu của `@nestjs/schedule`. Vì code
import `CronJob`/`validateCronExpression` trực tiếp (như tài liệu Nest cho dynamic cron)
và repo cài `npm install --no-package-lock`, khai báo `"cron": "^4.4.0"` trong
`dependencies` để phiên bản không trôi theo bắc cầu.

## 3. Biến môi trường và nơi kiểm tra biểu thức cron (FR-004, FR-006, FR-007, FR-013)

**Decision**: thêm vào `configSchema` (`src/shared/config.ts`):

| Biến | Zod | Mặc định | Ghi chú |
|---|---|---|---|
| `CRON_PORT` | `z.string()` | `'3001'` | cổng của dịch vụ job; `.env.example` đặt `9998` (API đang `9999`) |
| `CRON_SHUTDOWN_GRACE_SECONDS` | `z.coerce.number().int().nonnegative()` | `30` | ân hạn drain khi SIGTERM |
| `CRON_TOPUP_RECONCILE` | `z.string().optional().transform(emptyToUndefined)` | (không) | ghi đè lịch job đối soát; `off` tắt |

Lịch mặc định của job đối soát là `*/${SEPAY_RECONCILE_INTERVAL_MINUTES} * * * *`
(đúng biểu thức `topup.cron.ts` đang dùng), nên khi `CRON_TOPUP_RECONCILE` trống, hành
vi giống hệt hiện tại (FR-013); `SEPAY_RECONCILE_INTERVAL_MINUTES` tiếp tục là cửa sổ
nhìn lại khi gọi Sepay. Cú pháp biểu thức được kiểm tra ở `CronRunner` lúc bootstrap,
**không** trong Zod schema.

**Rationale**: `config.ts` dùng chung cho API, seed và cron. Nếu Zod từ chối biểu thức
cron sai, API cũng từ chối khởi động vì một lỗi chỉ thuộc về cron — trái tinh thần FR-002
(hai dịch vụ không kéo nhau xuống). Kiểm tra ở runner vẫn fail-fast trong vài giây và
thông báo nêu đúng tên biến (Nguyên tắc I được giữ ở mức "kiểu + rỗng → undefined" như
các biến optional khác). Chú thích trong `.env.example`: nếu ghi đè lịch thưa hơn cửa sổ
nhìn lại thì có thể bỏ sót giao dịch — chỉnh cả hai cùng nhau.

**Alternatives considered**:
- `z.string().refine(validateCronExpression)`: thông báo đẹp qua `z.prettifyError` nhưng
  chặn cả API/seed.
- Gộp lịch và cửa sổ nhìn lại vào một biến như hiện tại: không cho ghi đè bằng biểu thức
  cron đầy đủ (FR-006).

## 4. Tách `TopUpModule` để cron dùng service mà không kéo controller (FR-003, FR-005)

**Decision**: tạo `src/routes/topup/topup-core.module.ts` (`TopUpCoreModule`) chứa
`TopUpService`, `TopUpRepo`, `SepayApiClient` và export `TopUpService`, `SepayApiClient`.
`TopUpModule` import `TopUpCoreModule`, giữ `TopUpController` + `SepayWebhookGuard`.
`CronModule` import `TopUpCoreModule`. Xoá `topup.cron.ts`; logic chuyển nguyên sang
`src/cron/jobs/topup-reconcile.job.ts` (giữ vòng lặp bắt lỗi từng giao dịch).

**Rationale**: Nest đăng ký controller của **mọi** module được import, nên import
`TopUpModule` vào `CronModule` sẽ mở `POST /topups*` trên cổng cron (vi phạm FR-005).
Pattern module export provider đã có trong repo (`NodeCatalogModule` export
`NodeCatalogPublisherService`). Tách core/http là thay đổi nhỏ nhất, không đổi API.

**Alternatives considered**: khai báo lại `TopUpService`/`TopUpRepo`/`SepayApiClient`
trực tiếp trong `CronModule` providers — chạy được nhưng hai nơi phải giữ đồng bộ danh
sách provider, dễ lệch khi `TopUpService` thêm dependency.

## 5. Triển khai: compose, healthcheck, deploy script (FR-015, FR-016, FR-017)

**Decision**:
- `deploy/docker-compose.prod.yaml` thêm service `cron`: `image: *app-image`,
  `container_name: a2matex-cron`, `command: ['node', 'dist/cron/main.js']`, `env_file`
  `../.env.production`, `depends_on` `redis: service_healthy` + `migrate:
  service_completed_successfully` (giống `app`), `networks: [backend, edge]` (cần `edge`
  để tới Cloud SQL qua VPC — ghi chú đầu file compose), **không** `ports`, không sửa
  `Caddyfile` (FR-016). `healthcheck` khai báo riêng vì HEALTHCHECK trong Dockerfile curl
  `${PORT}` (cổng API): `curl -fsS "http://127.0.0.1:$${CRON_PORT:-9998}/$${API_PREFIX:-api/v1}/health"`,
  interval 30s, timeout 5s, start_period 20s, retries 3. `stop_grace_period: 45s` để Docker
  không SIGKILL trước khi hết `CRON_SHUTDOWN_GRACE_SECONDS=30` (FR-017); `dumb-init` đã
  chuyển SIGTERM tới node.
- `deploy/vps-deploy.sh`: vòng chờ healthy lặp qua `a2matex-app a2matex-cron`; container
  nào không healthy trong `HEALTH_TIMEOUT` thì in `docker logs --tail 50` của chính nó rồi
  `exit 1` (SC-006). Không đổi `.github/workflows/deploy.yml`; Dockerfile không đổi ngoài
  comment vai trò (CMD mặc định vẫn là API).
- `.env.production.example`: thêm `CRON_PORT=9998`, `CRON_SHUTDOWN_GRACE_SECONDS=30`,
  `CRON_TOPUP_RECONCILE=` kèm chú thích.

**Rationale**: một image, hai `command` là cách rẻ nhất giữ FR-015 (cùng bản build);
healthcheck riêng tránh sửa Dockerfile cho từng vai trò. `migrate` chạy lại trong `up -d`
là hành vi đã có với `app` (idempotent).

**Alternatives considered**: `ports: '127.0.0.1:9998:9998'` để curl từ host — không cần,
deploy script dùng `docker inspect` health status; mở port chỉ tăng bề mặt.

## 6. Cấu trúc mã nguồn: entry point thứ hai vs Nest monorepo (đã chốt ở spec)

**Decision**: `src/cron/main.ts` + `src/cron/cron.module.ts` trong cùng package; `tsc`
với `tsconfig.build.json` (`include: ["src"]`, `rootDir: ./src`) tự sinh
`dist/cron/main.js`. Scripts: `start:cron` (`tsx src/cron/main.ts`), `start:cron:dev`
(`tsx watch src/cron/main.ts`), `start:cron:prod` (`node dist/cron/main.js`).

**Rationale**: spec Assumptions ghi chủ repo đã chốt; monorepo (`nest-cli.json`
`projects`, `apps/`, `libs/`) đòi đổi tsconfig, Dockerfile (đang copy `src` cho seed), CI
và vitest cho 1–2 job.

## 7. Kiểm thử (SC-001…SC-007)

**Decision**:
- `src/cron/test/cron-job.interface.spec.ts`: `resolveCronSchedule` trả `source: 'env'`
  khi có giá trị, `'default'` khi trống, giữ nguyên `'off'`.
- `src/cron/test/cron-runner.service.spec.ts` (không DB/Redis; `SchedulerRegistry` thật +
  job giả): tên trùng → throw; biểu thức sai → throw có chứa `envKey` và giá trị; `off` →
  không đăng ký, có log; chạy chồng → lần hai bị bỏ qua và log; job ném lỗi → runner không
  ném, log lỗi, job khác vẫn chạy; shutdown → chờ in-flight xong trước ân hạn, quá ân hạn
  thì vẫn resolve (dùng `vi.useFakeTimers()`).
- `src/cron/test/topup-reconcile.job.spec.ts`: mock `SepayApiClient`/`TopUpService`; một
  giao dịch lỗi không chặn giao dịch sau (giữ hành vi `topup.cron.ts`).
- `test/cron.e2e-spec.ts`: `Test.createTestingModule({ imports: [CronModule] })` +
  `registerCronHealthRoute(app)`; `GET /api/v1/health` → 200 JSON `status: 'ok'`;
  `POST /api/v1/topups` → 404. Cần Redis/DB như `test/app.e2e-spec.ts` hiện có.
- Các SC về deploy (SC-005, SC-006, SC-007) kiểm chứng tay theo `quickstart.md`.

**Rationale**: runner là nơi chứa toàn bộ hành vi FR-007…FR-011, FR-017 nên test đơn vị
ở đó bao phủ gần hết spec mà không cần hạ tầng; e2e chỉ xác nhận wiring của module.

## 8. Múi giờ và vài ràng buộc nhỏ

- Biểu thức cron được đánh giá theo múi giờ tiến trình (container: UTC), giống `@Cron`
  hiện tại; không thêm tuỳ chọn timezone (YAGNI).
- `SharedModule` là `@Global()` và kết nối Redis trong factory, nên `CronModule` cũng
  không khởi động được khi Redis chưa sẵn sàng — đúng edge case "hạ tầng chưa sẵn sàng"
  trong spec (restart policy `unless-stopped` lo phần khởi động lại).
- Log truy vấn Prisma (`prisma:query`) in ra ở cả hai dịch vụ — hành vi có sẵn, ngoài
  phạm vi.
