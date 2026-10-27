---

description: "Task list template for feature implementation"
---

# Tasks: Tách job định kỳ ra dịch vụ riêng

**Input**: Design documents from `/specs/005-separate-cron-server/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/cron-service.md, quickstart.md

**Tests**: plan.md § Testing và research.md §7 khai báo rõ các test đơn vị/e2e cần có, nên
tasks dưới đây gồm test task đi kèm từng story (không TDD bắt buộc; viết test ngay sau
hoặc song song với code của cùng story).

**Organization**: Task nhóm theo user story trong `spec.md` — US1 = Story 1 (P1, job chạy
trên dịch vụ riêng, API không chạy job), US2 = Story 2 (P2, thêm job bằng một định nghĩa +
một biến env, validate/off/chặn chạy chồng), US3 = Story 3 (P3, triển khai, giám sát, dừng
an toàn, dev cục bộ).

**Kích thước task**: theo yêu cầu của chủ repo, mỗi task ước lượng **dưới 4 giờ** (ghi
`(~Xh)` cuối mỗi task; lớn nhất là T018 ~3h). Tổng ước lượng ≈ 31h.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Có thể làm song song (file khác nhau, không phụ thuộc task chưa xong)
- **[Story]**: US1, US2 hoặc US3
- File path chính xác được ghi trong từng task

## Path Conventions

Single project (NestJS backend) với hai entry point `src/main.ts` (API) và
`src/cron/main.ts` (job), cùng `tsc` build ra `dist/`, cùng Docker image — theo
`plan.md` § Project Structure. `src/cron/` nằm ngoài `src/routes/` vì không phải HTTP
route module.

---

## Phase 1: Setup

**Purpose**: Dependency, script và biến môi trường dùng chung cho mọi phase sau.

- [X] T001 Khai báo dependency `"cron": "^4.4.0"` trong `dependencies` của `package.json`
  (hiện chỉ là dependency bắc cầu của `@nestjs/schedule`; code sẽ import trực tiếp
  `CronJob`, `validateCronExpression` — research.md §2) và thêm 3 script:
  `"start:cron": "tsx src/cron/main.ts"`, `"start:cron:dev": "tsx watch src/cron/main.ts"`,
  `"start:cron:prod": "node dist/cron/main.js"`. Chạy `npm install --no-package-lock`
  rồi xác nhận `node --input-type=module -e "import { CronJob, validateCronExpression } from 'cron'; console.log(typeof CronJob)"`
  in `function` (named ESM import đã kiểm chứng chạy được với cron 4.4.0). (~0.5h)
- [X] T002 [P] Thêm vào `configSchema` trong `src/shared/config.ts` (contracts/cron-service.md §2):
  `CRON_PORT: z.string().default('3001')`,
  `CRON_SHUTDOWN_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(30)`,
  `CRON_TOPUP_RECONCILE: z.string().optional().transform(emptyToUndefined)`. **Không**
  validate cú pháp cron trong Zod (research.md §3 — để API không bị chặn khởi động vì lỗi
  riêng của cron); thêm comment nêu lý do ngay trên nhóm biến `CRON_*`. (~0.5h)
- [X] T003 [P] Thêm vào `.env.example` (`CRON_PORT=9998`, `CRON_SHUTDOWN_GRACE_SECONDS=30`,
  `CRON_TOPUP_RECONCILE=`) và `.env.production.example` (nhóm `# --- Cron service ---`
  cùng 3 biến, `CRON_PORT=9998`) kèm chú thích: trống = `*/${SEPAY_RECONCILE_INTERVAL_MINUTES} * * * *`;
  `off` tắt job; nếu ghi đè lịch thưa hơn `SEPAY_RECONCILE_INTERVAL_MINUTES` thì có thể bỏ
  sót giao dịch nên chỉnh cả hai cùng nhau. (~0.5h)

**Checkpoint**: `npm run start:dev` vẫn khởi động bình thường với env mới (chưa có gì dùng
`CRON_*`).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Interface job dùng chung cho mọi story và tách module top-up để cron import
được service mà không kéo controller.

**⚠️ CRITICAL**: Không bắt đầu Phase 3 trước khi xong T004 và T006.

- [X] T004 Tạo `src/cron/cron-job.interface.ts` theo đúng `data-model.md` § CronJobDefinition:
  `export const CRON_JOBS = Symbol('CRON_JOBS')`, `export const CRON_SCHEDULE_OFF = 'off'`,
  `export type CronScheduleSource = 'env' | 'default'`, interface `CronJobDefinition` với
  `readonly name: string` (duy nhất, kebab-case), `readonly envKey: string` (dạng
  `CRON_<JOB>`), `readonly schedule: string` (biểu thức cron 5 trường hoặc đúng `'off'`),
  `readonly scheduleSource: CronScheduleSource`, `run(): Promise<void>` (PHẢI idempotent —
  FR-014, ghi trong JSDoc). Hàm `resolveCronSchedule(override: string | undefined, fallback: string)`
  trả `{ schedule, scheduleSource }`: `override` sau `trim()` có giá trị → `('env', override)`,
  nếu bằng `off` không phân biệt hoa thường → `schedule = CRON_SCHEDULE_OFF`; trống/undefined →
  `('default', fallback)`. (~1h)
- [X] T005 [P] Viết `src/cron/test/cron-job.interface.spec.ts` (Vitest, không DB): `resolveCronSchedule`
  trả `source: 'env'` khi có override, `'default'` khi `undefined` hoặc `''`, chuẩn hoá
  `' OFF '` thành `'off'`, giữ nguyên biểu thức đã trim. (~0.5h)
- [X] T006 [P] Tách module top-up (research.md §4): tạo `src/routes/topup/topup-core.module.ts`
  (`TopUpCoreModule`: `providers: [TopUpService, TopUpRepo, SepayApiClient]`,
  `exports: [TopUpService, SepayApiClient]`); sửa `src/routes/topup/topup.module.ts` thành
  `imports: [TopUpCoreModule]`, `providers: [SepayWebhookGuard]`, `controllers: [TopUpController]`,
  **bỏ** `TopUpCron` khỏi providers (file `topup.cron.ts` xoá ở T007). Khởi động API, xác nhận
  `POST /api/v1/topups` và webhook vẫn hoạt động (quickstart spec 002 Scenario 1). (~1h)

**Checkpoint**: Interface job + helper có test xanh; API chạy với `TopUpCoreModule` tách
riêng, không còn job nào đăng ký trong `TopUpModule`.

---

## Phase 3: User Story 1 - Job định kỳ chạy trên dịch vụ riêng, API không chạy job nữa (Priority: P1) 🎯 MVP

**Goal**: Tiến trình `src/cron/main.ts` chạy `CronModule` trên `CRON_PORT`, chỉ phục vụ
`GET /<API_PREFIX>/health`, chạy job đối soát Sepay y như trước; API bỏ
`ScheduleModule` và không chạy job nào.

**Independent Test**: quickstart.md Scenario 1 — hai dịch vụ lên trên hai cổng, health
200 ở cả hai, `POST /api/v1/topups` trên cổng cron → 404, log `CronRunner` chỉ ở
terminal cron, tắt một bên không ảnh hưởng bên kia.

### Implementation for User Story 1

- [X] T007 [US1] Tạo `src/cron/jobs/topup-reconcile.job.ts`: `@Injectable() TopUpReconcileJob implements CronJobDefinition`
  với `name = 'topup-reconcile'`, `envKey = 'CRON_TOPUP_RECONCILE'`, `schedule`/`scheduleSource`
  từ `resolveCronSchedule(envConfig.CRON_TOPUP_RECONCILE, `*/${envConfig.SEPAY_RECONCILE_INTERVAL_MINUTES} * * * *`)`
  trong constructor; inject `SepayApiClient`, `TopUpService`; `run()` chuyển nguyên logic từ
  `src/routes/topup/topup.cron.ts` (`listRecentTransactions(SEPAY_RECONCILE_INTERVAL_MINUTES)`
  rồi `handleIncomingTransaction` từng giao dịch trong `try/catch` riêng, `logger.error`
  kèm `transaction.id` — FR-013). Xoá `src/routes/topup/topup.cron.ts`. (~1h)
- [X] T008 [P] [US1] Viết `src/cron/test/topup-reconcile.job.spec.ts`: mock `SepayApiClient.listRecentTransactions`
  và `TopUpService.handleIncomingTransaction` (theo kiểu `as unknown as` như
  `src/routes/node-catalog/test/node-catalog.service.spec.ts`); case: gọi
  `handleIncomingTransaction` cho mọi giao dịch; giao dịch đầu ném lỗi thì giao dịch sau
  vẫn được xử lý và `run()` không ném; `schedule` mặc định bằng
  `*/<SEPAY_RECONCILE_INTERVAL_MINUTES> * * * *` với `scheduleSource = 'default'`. (~1h)
- [X] T009 [US1] Tạo `src/cron/cron-runner.service.ts` (bản tối thiểu cho US1; mở rộng ở
  T016/T017/T021): `@Injectable() CronRunner implements OnApplicationBootstrap`, inject
  `@Inject(CRON_JOBS) jobs: CronJobDefinition[]` và `SchedulerRegistry`
  (`@nestjs/schedule`); `private readonly logger = new Logger(CronRunner.name)`.
  `onApplicationBootstrap()`: với mỗi job tạo
  `new CronJob(job.schedule, () => void this.execute(job), null, false)` (import từ `cron`),
  `schedulerRegistry.addCronJob(job.name, cronJob)`, `cronJob.start()`, log
  `registered name=<name> schedule="<schedule>" source=<env|default> nextRun=<cronJob.nextDate().toISO()>`
  (FR-009). `execute(job)`: log `started name=<name>`, `await job.run()`, log
  `finished name=<name> durationMs=<n> outcome=success`; lỗi → `logger.error(`failed name=<name> durationMs=<n> outcome=error`, stack)`,
  không ném ra ngoài (FR-010). (~2h)
- [X] T010 [P] [US1] Tạo `src/cron/cron-health.ts`: `export function registerCronHealthRoute(app: INestApplication)`
  gọi `app.getHttpAdapter().get(`${API_PREFIX_PATH}/health`, (_req, res) => res.json({ status: 'ok', service: 'cron', uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString() }))`
  (`API_PREFIX_PATH` từ `src/shared/constants/system.constant.ts`). Ghi comment: không dùng
  controller vì `src/seed/create-permissions.ts` quét đệ quy mọi file `*controller.ts` trong
  `src/` và sẽ tạo Permission record trùng `GET /health` (research.md §1). (~0.5h)
- [X] T011 [US1] Tạo `src/cron/cron.module.ts`: `imports: [ScheduleModule.forRoot(), SharedModule, TopUpCoreModule]`,
  `providers: [CronRunner, TopUpReconcileJob, { provide: CRON_JOBS, useFactory: (...jobs: CronJobDefinition[]) => jobs, inject: [TopUpReconcileJob] }]`,
  **không** có `controllers`. Comment trên multi-provider: "danh sách job duy nhất — thêm
  job = thêm class vào `providers` và vào `inject` này" (FR-012). (~0.5h)
- [X] T012 [US1] Tạo `src/cron/main.ts`: `NestFactory.create<NestExpressApplication>(CronModule)`,
  `registerCronHealthRoute(app)`, `app.enableShutdownHooks()`,
  `await app.listen(Number(envConfig.CRON_PORT), envConfig.HOST)`, log
  `Cron service is running on http://<HOST>:<CRON_PORT>/<API_PREFIX>/health` với context
  `CronBootstrap`. Bọc `bootstrap()` trong `try/catch`: lỗi → `Logger.error(message, stack, 'CronBootstrap')`
  rồi `process.exit(1)` (SC-004). Không set `trust proxy`, không CORS, không Swagger. (~1h)
- [X] T013 [US1] Sửa `src/app.module.ts`: bỏ import `ScheduleModule` và dòng
  `ScheduleModule.forRoot()` khỏi `imports`. Xác nhận
  `grep -rn "@nestjs/schedule" src --include='*.ts'` chỉ còn khớp trong `src/cron/`;
  chạy `npm run start:dev` và xác nhận log API không có context `CronRunner`;
  `npm run test:e2e -- test/app` vẫn xanh. (~0.5h)
- [X] T014 [US1] Viết `test/cron.e2e-spec.ts` theo pattern `test/app.e2e-spec.ts`:
  `Test.createTestingModule({ imports: [CronModule] })` → `createNestApplication()` →
  `registerCronHealthRoute(app)` → `app.init()`; `GET /api/v1/health` → 200, body có
  `status: 'ok'` và `service: 'cron'` (không bọc `data`); `POST /api/v1/topups` → 404;
  `afterEach` `app.close()`. Ghi chú đầu file: cần Redis/DB như e2e hiện có. (~1h)
- [X] T015 [US1] Chạy tay quickstart.md Scenario 1 (hai terminal `npm run start:dev` +
  `npm run start:cron:dev`, `CRON_TOPUP_RECONCILE="* * * * *"` để thấy tick mỗi phút,
  tắt từng bên); ghi kết quả vào mục Notes cuối file này. (~0.5h)

**Checkpoint**: User Story 1 hoạt động độc lập — API không chạy job, cron chạy đối soát
Sepay đúng chu kỳ mặc định trên cổng riêng (SC-001, SC-005 phần local).

---

## Phase 4: User Story 2 - Thêm một job mới chỉ bằng một định nghĩa job và một biến cấu hình (Priority: P2)

**Goal**: `CronRunner` validate biểu thức lúc khởi động (từ chối và nêu tên biến), tôn
trọng `off`, log danh sách job, chặn chạy chồng, cô lập lỗi; tài liệu hướng dẫn thêm job.

**Independent Test**: quickstart.md Scenario 2 (env override, sai cú pháp → thoát mã 1 nêu
`CRON_TOPUP_RECONCILE`, `off` → disabled) và Scenario 3 (`npm test -- src/cron`).

### Implementation for User Story 2

- [X] T016 [US2] Mở rộng `onApplicationBootstrap()` trong `src/cron/cron-runner.service.ts`
  (research.md §2): (a) tên trùng → `throw new Error(`Duplicate cron job name "<name>"`)`;
  (b) `job.schedule === CRON_SCHEDULE_OFF` → `logger.log(`disabled name=<name> (<envKey>=off)`)`
  và bỏ qua, không đăng ký (FR-008); (c) `const result = validateCronExpression(job.schedule)`
  (import từ `cron`; trả `{ valid: boolean; error?: Error }`), nếu `!result.valid` →
  `throw new Error(`${job.envKey}="${job.schedule}" is not a valid cron expression: ${result.error?.message ?? 'unknown'}`)`
  (FR-007). Thứ tự: trùng tên → off → validate → đăng ký. Kiểm tra bằng tay:
  `CRON_TOPUP_RECONCILE="every 5 minutes" npm run start:cron` thoát mã 1 trong vài giây và
  log có đúng chuỗi trên; API đang chạy không bị ảnh hưởng. (~1.5h)
- [X] T017 [US2] Thêm chặn chạy chồng vào `execute()` trong `src/cron/cron-runner.service.ts`
  (data-model.md § Trạng thái runner): field `private readonly inFlight = new Map<string, Promise<void>>()`;
  nếu `inFlight.has(job.name)` → `logger.warn(`skipped name=<name> outcome=skipped reason="previous run still in progress"`)`
  và return (FR-011); ngược lại tạo promise chạy job, `inFlight.set`, `await`, `finally inFlight.delete`.
  Giữ nguyên bảo đảm lỗi không rơi ra ngoài (FR-010). (~1h)
- [X] T018 [US2] Viết `src/cron/test/cron-runner.service.spec.ts` (Vitest, không DB; dùng
  `new SchedulerRegistry()` thật và job giả implement `CronJobDefinition`;
  `vi.useFakeTimers()` khi cần): (1) hai job cùng `name` → `onApplicationBootstrap()` reject
  với message chứa tên; (2) `schedule = 'bad expr'` → reject, message chứa `envKey` và giá
  trị; (3) `schedule = 'off'` → không có trong `registry.getCronJobs()`, có log "disabled";
  (4) job hợp lệ → có trong registry, log "registered" chứa `source=` và `nextRun=`;
  (5) gọi `execute(job)` hai lần khi `run()` chưa resolve → lần hai log warn "skipped" và
  `run` chỉ được gọi 1 lần; (6) `run()` reject → `execute()` resolve, có log error, job thứ
  hai vẫn chạy được; (7) outcome/durationMs xuất hiện trong log "finished". Tổng ~7 case,
  đây là task lớn nhất của tính năng. (~3h)
- [X] T019 [P] [US2] Thêm mục `## Job định kỳ (cron service)` vào `README.md` (sau mục
  "Phát triển cục bộ"): mô tả dịch vụ job chạy riêng, bảng 3 biến `CRON_*`, giá trị `off`,
  và công thức 3 bước thêm job lấy từ `contracts/cron-service.md` §3 (file
  `src/cron/jobs/<ten-job>.job.ts` implement `CronJobDefinition`, thêm biến vào
  `configSchema` + hai `.env*.example`, đăng ký vào `providers` + `inject` của `CRON_JOBS`
  trong `src/cron/cron.module.ts`; chỉ import module **không có controller**). Ghi rõ job
  phải idempotent (FR-014) và runner đã lo validate/log/chặn chạy chồng/drain. (~1h)
- [X] T020 [US2] Chạy tay quickstart.md Scenario 2 và Scenario 3 (`npm test -- src/cron`);
  ghi kết quả vào Notes. (~0.5h)

**Checkpoint**: US1 và US2 hoạt động độc lập — thêm một job giả (log mỗi phút) theo README
chỉ cần 1 file + 1 biến + 1 dòng đăng ký, không sửa API (SC-003, SC-004).

---

## Phase 5: User Story 3 - Triển khai, giám sát và dừng an toàn (Priority: P3)

**Goal**: Cron drain lần chạy dở khi SIGTERM trong ân hạn; compose có service `cron` cùng
image, healthcheck riêng, không publish port; deploy script chờ cả hai container; README
và runbook cập nhật; dev cục bộ chạy hai dịch vụ từ một `.env`.

**Independent Test**: quickstart.md Scenario 4 (SIGTERM drain) và Scenario 6 (deploy trên
VPS, cả hai container cùng `IMAGE_TAG` và healthy, cổng cron không ra Internet, deploy
thất bại khi cron không khỏe).

### Implementation for User Story 3

- [X] T021 [US3] Thêm dừng an toàn vào `src/cron/cron-runner.service.ts`: implement
  `BeforeApplicationShutdown`; `beforeApplicationShutdown(signal?)`: với mọi job trong
  `schedulerRegistry.getCronJobs()` gọi `job.stop()` (không tick mới); nếu
  `inFlight.size > 0` → `logger.log(`shutdown: waiting for <n> in-flight job(s) up to <grace>s (signal=<signal>)`)`
  rồi `await Promise.race([Promise.allSettled([...inFlight.values()]), sleep(envConfig.CRON_SHUTDOWN_GRACE_SECONDS * 1000)])`
  (timer `unref()`); sau race nếu `inFlight.size > 0` → `logger.warn('shutdown: grace period exceeded, exiting with <n> job(s) still running')`
  (FR-017). `CRON_SHUTDOWN_GRACE_SECONDS = 0` → không chờ. (~1.5h)
- [X] T022 [US3] Bổ sung vào `src/cron/test/cron-runner.service.spec.ts` (cùng file T018,
  làm sau T018): (8) job đang chạy xong trong ân hạn → `beforeApplicationShutdown()` resolve
  ngay sau khi job xong, không có warn; (9) job chạy lâu hơn ân hạn → resolve sau đúng
  `grace` giây (fake timers) và có warn "grace period exceeded"; (10) sau
  `beforeApplicationShutdown()` mọi `CronJob` trong registry có `isActive === false`. (~1.5h)
- [X] T023 [P] [US3] Sửa `deploy/docker-compose.prod.yaml` theo contracts/cron-service.md §5:
  thêm service `cron` sau `app` — `image: *app-image`, `container_name: a2matex-cron`,
  `restart: unless-stopped`, `command: ['node', 'dist/cron/main.js']`,
  `env_file: [../.env.production]`, `stop_grace_period: 45s` (comment: phải lớn hơn
  `CRON_SHUTDOWN_GRACE_SECONDS=30` — FR-017), `healthcheck.test: ['CMD-SHELL', 'curl -fsS "http://127.0.0.1:$${CRON_PORT:-9998}/$${API_PREFIX:-api/v1}/health" || exit 1']`,
  `interval: 30s`, `timeout: 5s`, `start_period: 20s`, `retries: 3`,
  `depends_on: { redis: { condition: service_healthy }, migrate: { condition: service_completed_successfully } }`,
  `networks: [backend, edge]`, **không** `ports`. Cập nhật comment đầu file (nêu `cron`
  cùng image với `app`, cần `edge` để tới Cloud SQL). Không sửa `deploy/Caddyfile`
  (FR-016). Kiểm tra cú pháp:
  `docker compose --env-file .env.production.example -f deploy/docker-compose.prod.yaml config`
  (bỏ qua cảnh báo CHANGE_ME). (~1.5h)
- [X] T024 [P] [US3] Sửa `deploy/vps-deploy.sh`: thay vòng chờ chỉ kiểm tra `a2matex-app`
  bằng vòng lặp qua `for container in a2matex-app a2matex-cron`, mỗi container chờ
  `healthy` trong cùng `HEALTH_TIMEOUT` (deadline tính chung từ lúc `up`); hết hạn → in
  `compose ps`, `docker logs --tail 50` của **container không khỏe** (và `a2matex-migrate`
  như hiện tại), `exit 1`; thông điệp lỗi nêu tên container. Chạy `bash -n deploy/vps-deploy.sh`
  và `shellcheck` nếu có. (~1h)
- [X] T025 [P] [US3] Sửa comment đầu `Dockerfile` ("One image serves three roles" → bốn vai
  trò, thêm dòng cron `node dist/cron/main.js`); không đổi lệnh nào khác. Xác nhận
  `npm run build` sinh `dist/cron/main.js` và `npm run start:cron:prod` lên được health
  trên `CRON_PORT` (quickstart Scenario 5). (~0.5h)
- [X] T026 [P] [US3] Cập nhật `README.md` mục "Phát triển cục bộ": thêm dòng
  `npm run start:cron:dev           # job định kỳ, cổng CRON_PORT (9998)` sau
  `npm run start:dev`, và một câu: API và cron đọc cùng `.env`, hai cổng mặc định khác nhau
  (FR-018). (~0.5h)
- [X] T027 [P] [US3] Cập nhật `docs/deployment-runbook.md`: mục B "Xem trạng thái và log"
  thêm `docker logs -f a2matex-cron` và cách đọc dòng `CronRunner registered ...`; mục B
  "Deploy" ghi deploy chờ cả `a2matex-app` lẫn `a2matex-cron`; mục C "Sự cố thường gặp"
  thêm "cron không healthy": kiểm tra `CRON_*` trong `.env.production` (biểu thức sai →
  container thoát mã 1 lặp lại, xem log), và cách tắt tạm một job bằng `off`. (~1h)
- [ ] T028 [US3] Chạy tay quickstart.md Scenario 4 (SIGTERM drain với
  `CRON_SHUTDOWN_GRACE_SECONDS=30` rồi `0`) ở local; Scenario 6 trên VPS **chỉ sau khi chủ
  repo đồng ý merge vào `staging`/deploy** (bao gồm phép thử cố ý `CRON_TOPUP_RECONCILE=bad`
  → deploy thất bại, app cũ vẫn phục vụ, rồi trả lại giá trị đúng). Ghi kết quả vào Notes.
  (~2h)

**Checkpoint**: Cả ba story hoạt động độc lập — deploy một lần ra hai container cùng
phiên bản, cron drain đúng ân hạn (SC-006, SC-007).

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Cổng chất lượng (Nguyên tắc IV) và dọn dẹp tham chiếu cũ.

- [X] T029 Chạy `npm run lint && npm test && npm run build`; sửa mọi lỗi oxlint trong
  `src/cron/**` (đặc biệt `typescript/no-floating-promises`: dùng `void this.execute(job)`
  có chủ đích trong callback của `CronJob`) và format bằng `npm run format`. (~1h)
- [X] T030 [P] Dọn tham chiếu cũ: `grep -rn "TopUpCron\|topup.cron" src test specs/002-sepay-wallet-topup`
  phải không còn khớp trong `src`/`test`; thêm một dòng ghi chú ở `specs/002-sepay-wallet-topup/plan.md`
  § Project Structure rằng `topup.cron.ts` đã chuyển sang `src/cron/jobs/topup-reconcile.job.ts`
  theo spec 005 (không sửa gì khác ở spec 002). (~0.5h)
- [X] T031 Chạy lại toàn bộ `quickstart.md` Scenario 1–5 trên bản build cuối
  (`npm run build` + `npm run start:prod` + `npm run start:cron:prod`), cập nhật
  `specs/005-separate-cron-server/quickstart.md` nếu lệnh/log thực tế khác mô tả; đánh dấu
  `[x]` các task đã xong trong file này. (~1h)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: bắt đầu ngay; T002, T003 song song với T001.
- **Foundational (Phase 2)**: T004 cần T001 (import `cron` chưa cần ở đây nhưng
  `npm install` đã chạy); T005 sau T004; T006 độc lập với T004/T005 (chỉ đụng
  `src/routes/topup/`). BLOCKS Phase 3.
- **US1 (Phase 3)**: cần T004 + T006. Thứ tự: T007 → (T008 song song) → T009 → T010 (song
  song với T009) → T011 (cần T007, T009, T010) → T012 → T013 → T014 → T015.
- **US2 (Phase 4)**: cần US1 xong (cùng file `cron-runner.service.ts`). T016 → T017 →
  T018; T019 song song từ đầu phase; T020 cuối.
- **US3 (Phase 5)**: T021 → T022 cần US2 xong (cùng file runner/spec). T023, T024, T025,
  T026, T027 độc lập với T021/T022 và với nhau, có thể bắt đầu ngay sau US1. T028 cuối
  cùng, phần VPS cần chủ repo cho phép deploy.
- **Polish (Phase 6)**: sau mọi story mong muốn; T030 song song với T029.

### Trong từng User Story

- Interface/helper trước job; job trước runner; runner trước module; module trước
  `main.ts`; `main.ts` trước e2e; validation tay cuối cùng.
- Test của story viết ngay sau code của cùng story, cùng PR.

### Parallel Opportunities

- Phase 1: T001 ∥ T002 ∥ T003.
- Phase 2: T005 ∥ T006 (sau T004 với T005).
- US1: T008 ∥ T009 ∥ T010 (sau T007).
- US2: T019 ∥ T016/T017/T018.
- US3: T023 ∥ T024 ∥ T025 ∥ T026 ∥ T027 ∥ (T021 → T022).
- Polish: T029 ∥ T030.

---

## Parallel Example: User Story 1

```bash
# Sau khi T007 (job) xong, ba task sau chạy song song (file khác nhau):
Task: "Viết src/cron/test/topup-reconcile.job.spec.ts"            # T008
Task: "Tạo src/cron/cron-runner.service.ts (bản tối thiểu)"       # T009
Task: "Tạo src/cron/cron-health.ts"                                # T010
# Rồi tuần tự: T011 cron.module.ts → T012 main.ts → T013 app.module.ts → T014 e2e → T015 tay
```

## Parallel Example: User Story 3

```bash
# Ngay sau US1, một người làm runner (T021 → T022), người khác làm deploy/doc song song:
Task: "Sửa deploy/docker-compose.prod.yaml: service cron"         # T023
Task: "Sửa deploy/vps-deploy.sh: chờ a2matex-cron"                 # T024
Task: "Sửa comment Dockerfile + xác nhận dist/cron/main.js"        # T025
Task: "README mục Phát triển cục bộ"                               # T026
Task: "docs/deployment-runbook.md mục B/C"                         # T027
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 (T001–T003) → Phase 2 (T004–T006).
2. Phase 3 (T007–T015): cron chạy riêng, API không còn job.
3. **DỪNG VÀ KIỂM CHỨNG** quickstart Scenario 1; có thể deploy MVP này nếu chấp nhận tạm
   thời chưa có validate/off/drain (runner tối thiểu vẫn log và bắt lỗi).

### Incremental Delivery

1. Setup + Foundational → nền sẵn sàng.
2. US1 → kiểm chứng độc lập → MVP.
3. US2 → validate/off/chặn chạy chồng + README thêm job → kiểm chứng Scenario 2–3.
4. US3 → drain + compose + deploy script + runbook → kiểm chứng Scenario 4–6 → deploy
   thật (khi chủ repo đồng ý).
5. Polish → lint/test/build xanh, quickstart chạy lại trên bản build cuối.

### Phân bổ thời gian (ước lượng)

| Phase | Task | Ước lượng |
|---|---|---|
| 1 Setup | T001–T003 | ~1.5h |
| 2 Foundational | T004–T006 | ~2.5h |
| 3 US1 | T007–T015 | ~8h |
| 4 US2 | T016–T020 | ~7h |
| 5 US3 | T021–T028 | ~9.5h |
| 6 Polish | T029–T031 | ~2.5h |
| **Tổng** | 31 task | **~31h** |

Mọi task đều dưới 4h; task dài nhất là T018 (~3h, unit test runner) và T028 (~2h, kiểm
chứng tay gồm deploy).

---

## Notes

- Không cần chạy lại `npm run seed:permissions`: không có route API mới; health của cron
  đăng ký trên HTTP adapter nên không bị seed quét (research.md §1).
- Không có migration, không đổi `schema.prisma`.
- Tuyệt đối không import `TopUpModule` (có controller) vào `CronModule`; chỉ
  `TopUpCoreModule`.
- Theo quy ước repo: không commit/push/mở PR cho đến khi chủ repo yêu cầu; các task
  "chạy tay" ghi kết quả vào đây dưới dạng gạch đầu dòng `YYYY-MM-DD — Scenario N: ...`.
- [P] = file khác nhau, không phụ thuộc task chưa xong; [Story] để truy vết về spec.

### Kết quả implement 2026-10-27 (chưa commit, working tree trên `ffeature/separate-cron-server`)

- Đã xong 30/31 task. Cổng chất lượng: `npm run lint` 0 lỗi (chỉ warning có sẵn ngoài
  `src/cron`), `npm test` 18 file / 85 test xanh (`src/cron` 3 file / 19 test),
  `npm run test:e2e -- test/cron` 2/2 xanh với Redis local, `npm run build` sinh
  `dist/cron/main.js`, `npx tsc --noEmit -p tsconfig.build.json` sạch.
- Thay đổi so với plan: drain khi dừng đặt ở `onModuleDestroy` thay vì
  `beforeApplicationShutdown` (research.md §2 đã cập nhật lý do: Redis bị ngắt trong
  `onModuleDestroy` của SharedModule, và mọi `onModuleDestroy` chạy trước mọi
  `beforeApplicationShutdown`). T021/T022 làm theo hook mới.
- Kiểm chứng tay đã làm (Docker Desktop bật theo yêu cầu chủ repo, `npm run compose-up`):
  - 2026-10-27 — Scenario 1: API 9999 và cron 9998 cùng lên; health cron trả JSON thuần
    `service: "cron"`; `POST /api/v1/topups` trên cổng cron → 404; log khởi động
    `registered name=topup-reconcile schedule="* * * * *" source=env nextRun=...`; tick
    thật lúc 14:28:00 `started` → `finished durationMs=650 outcome=success`; log API có
    0 dòng `CronRunner`; dừng API xong cron vẫn trả 200; SIGTERM cron → `shutdown: no
    in-flight job`, tiến trình thoát.
  - 2026-10-27 — Scenario 2: `CRON_TOPUP_RECONCILE="every 5 minutes"` → thoát mã 1 với
    `[CronBootstrap] CRON_TOPUP_RECONCILE="every 5 minutes" is not a valid cron
    expression: Unknown alias: eve`; `CRON_TOPUP_RECONCILE=off` → `disabled
    name=topup-reconcile (CRON_TOPUP_RECONCILE=off)`, không đăng ký job, health vẫn 200.
  - 2026-10-27 — Scenario 3: `npm test -- src/cron` xanh.
  - 2026-10-27 — Scenario 4: SIGTERM khi không có job dở → thoát sạch mã 0. Trường hợp
    job đang dở lúc SIGTERM chỉ kiểm chứng bằng unit test (T022), vì job đối soát thật
    kết thúc trong < 1 giây nên không bắt được giữa chừng.
  - 2026-10-27 — Scenario 5: `npm run start:cron:prod` từ `dist/` lên health 200, lịch
    mặc định `*/15 * * * *` `source=default`.
  - 2026-10-27 — T023: `docker compose config` (env mẫu, chạy trong scratchpad) render
    đúng service `cron`: cùng image với `app`, không `ports`, mạng `backend`+`edge`,
    `stop_grace_period 45s`, healthcheck theo `CRON_PORT`.
- Lưu ý local: `.env` của máy dev chưa có `CRON_PORT` nên cron mặc định lên cổng 3001;
  các kiểm chứng trên truyền `CRON_PORT=9998` tường minh. Thêm `CRON_PORT=9998` vào
  `.env` (theo `.env.example`) để `npm run start:cron:dev` dùng cổng 9998.
- Còn lại T028 phần VPS (Scenario 6): cần chủ repo đồng ý merge vào `staging`/deploy.
- Ngoài phạm vi task nhưng theo bước "project setup" của `/speckit-implement`: thêm
  `.prettierignore` (repo có `.prettierrc` mà chưa có ignore file).
- 2026-10-27 — Dọn code theo yêu cầu chủ repo: rút gọn comment trong `src/cron/**`,
  `topup-core.module.ts`, `topup.module.ts`, `config.ts` (chỉ giữ lý do không hiển
  nhiên: health không dùng controller vì seed quét, drain ở `onModuleDestroy`, không
  validate cron trong Zod); `resolveCronSchedule` bỏ tham số `envKey` chỉ truyền qua;
  bỏ export `CRON_HEALTH_PATH` không ai dùng. Lint/test/build chạy lại xanh.
- 2026-10-27 — Sửa lỗi phát hiện khi rà bước lên VPS: config mặc định `CRON_PORT=3001`
  nhưng healthcheck compose mặc định 9998, nên nếu `.env.production` chưa có `CRON_PORT`
  thì container cron không bao giờ healthy và deploy thất bại. Compose service `cron`
  giờ pin `environment: CRON_PORT: ${CRON_PORT:-9998}`; đã kiểm chứng bằng
  `docker compose config` với và không có biến trong env file.
