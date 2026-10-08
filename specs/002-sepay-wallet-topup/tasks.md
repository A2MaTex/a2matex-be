---

description: "Task list template for feature implementation"
---

# Tasks: Nạp tiền cho user qua Sepay

**Input**: Design documents from `/specs/002-sepay-wallet-topup/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/topup-api.md, quickstart.md

**Tests**: Spec không yêu cầu TDD/test task riêng — Polish phase chỉ xác nhận cổng chất
lượng hiện có (lint/test/build theo Nguyên tắc IV của constitution) và chạy lại
`quickstart.md` bằng tay, không viết test mới.

**Organization**: Task nhóm theo user story trong `spec.md` — US1 = Story 1 (P1, nạp tiền
& tự cập nhật số dư), US2 = Story 2 (P2, xem số dư hiện tại).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Có thể làm song song (file khác nhau, không phụ thuộc task chưa xong)
- **[Story]**: US1 hoặc US2
- File path chính xác được ghi trong từng task

## Path Conventions

Single project (NestJS backend, không có frontend trong repo) — `src/`, `test/`,
`prisma/` ở repo root, theo đúng cấu trúc đã mô tả trong `plan.md` § Project Structure.

---

## Phase 1: Setup

**Purpose**: Chuẩn bị cấu hình/dependency dùng chung cho toàn tính năng, trước khi đụng
tới schema hay business logic.

- [X] T001 Thêm các biến môi trường Sepay vào `configSchema` trong `src/shared/config.ts`:
  `SEPAY_WEBHOOK_API_KEY` (string, bắt buộc), `SEPAY_BANK_ACCOUNT_NUMBER`,
  `SEPAY_BANK_NAME`, `SEPAY_BANK_ACCOUNT_HOLDER` (string, bắt buộc — hiển thị trong
  response `POST /topups`), `SEPAY_API_BASE_URL` (string, bắt buộc, dùng cho job đối
  soát), `SEPAY_API_TOKEN` (string, bắt buộc), `SEPAY_RECONCILE_INTERVAL_MINUTES`
  (`z.coerce.number().int().positive().default(15)` — research.md §6). Thêm key tương ứng
  (giá trị mẫu) vào `.env.example` và `.env.production.example`.
- [X] T002 [P] Thêm dependency `@nestjs/schedule` vào `package.json`; import và đăng ký
  `ScheduleModule.forRoot()` trong mảng `imports` của `src/app.module.ts` (cần cho
  `@Cron()` ở T015).

**Checkpoint**: Cấu hình môi trường và dependency sẵn sàng cho cả Foundational và US1.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Thay đổi dữ liệu dùng chung cho cả hai user story — không story nào được
bắt đầu phần implementation trước khi xong phase này.

**⚠️ CRITICAL**: Không bắt đầu Phase 3/4 trước khi migration áp dụng sạch.

- [X] T003 Mở rộng `prisma/schema.prisma` theo đúng `data-model.md`:
  - Thêm field `balance BigInt @default(0)` vào model `Profile`.
  - Thêm enum `TopUpTransactionStatus { PENDING CREDITED UNMATCHED }`.
  - Thêm model `TopUpTransaction` với field: `id` (uuid, `@default(dbgenerated("gen_random_uuid()"))`),
    `userId` (uuid, nullable), `referenceCode` (string, nullable, **unique**),
    `requestedAmount` (BigInt, nullable), `receivedAmount` (BigInt, nullable),
    `providerTransactionId` (string, nullable, **unique**), `rawContent` (string,
    nullable — nội dung chuyển khoản gốc từ ngân hàng/Sepay, **bắt buộc set** cùng lúc
    với `receivedAmount`, là manh mối duy nhất để xử lý tay giao dịch `UNMATCHED` vì v1
    không có admin UI — data-model.md § TopUpTransaction), `status`
    (`TopUpTransactionStatus`, không có default — PHẢI set rõ lúc tạo), `creditedAt`
    (DateTime, nullable, `@db.Timestamptz(6)`), `createdAt` (DateTime,
    `@default(now())`, `@db.Timestamptz(6)`), `updatedAt` (DateTime, nullable,
    `@db.Timestamptz(6)`). **Không** thêm `deletedAt` — bản ghi immutable theo FR-006
    (data-model.md § TopUpTransaction).
- [X] T004 Tạo migration file bằng `npm run prisma:migrate:create` (tương đương
  `prisma migrate dev --create-only --config prisma7.config.ts`); kiểm tra migration SQL
  sinh ra ở `prisma/migrations/<timestamp>_*/migration.sql` áp dụng sạch trên database
  rỗng (`npm run prisma:migrate:deploy` trên DB test) trước khi commit (Nguyên tắc III).
- [X] T005 [P] Chạy `npm run prisma:generate` để cập nhật Prisma client
  (`src/generated/prisma/`) với field/model mới.
- [X] T006 [P] Cập nhật `src/entities/profile.model.ts`: thêm `balance: z.bigint()` vào
  `Profile = BaseWithUserFields.extend({...})`, export lại `ProfileType` (tự động theo
  `z.infer`).

**Checkpoint**: Schema + Prisma client + Zod entity đã có field `balance` — US1 và US2
đều có thể bắt đầu.

---

## Phase 3: User Story 1 - Nạp tiền qua chuyển khoản, số dư tự cập nhật (Priority: P1) 🎯 MVP

**Goal**: User tạo yêu cầu nạp tiền, nhận thông tin chuyển khoản gắn mã tham chiếu riêng;
hệ thống tự động cộng số dư khi Sepay báo giao dịch khớp (qua webhook đã xác thực nguồn,
hoặc qua đối soát chủ động nếu webhook bị thiếu), không cộng trùng, giữ lại giao dịch
không khớp được ai.

**Independent Test**: tạo yêu cầu nạp tiền, gọi webhook giả lập đúng mã tham chiếu và số
tiền, xác nhận `Profile.balance` của đúng user tăng đúng số tiền — không cần UI, không
cần US2 (xem `quickstart.md` Scenario 1-5).

### Implementation for User Story 1

- [X] T007 [P] [US1] Tạo `src/entities/topup-transaction.model.ts`: Zod schema
  `TopUpTransaction` mirror đúng field/kiểu của model Prisma ở T003 (bao gồm enum
  `TopUpTransactionStatus` dạng `z.enum(['PENDING', 'CREDITED', 'UNMATCHED'])`), export
  `TopUpTransactionType`, theo đúng pattern của `src/entities/profile.model.ts`.
- [X] T008 [P] [US1] Tạo `src/routes/topup/topup.model.ts` theo `contracts/topup-api.md`:
  - `CreateTopUpRequestInput`: `{ amount: z.number().int().positive() }` (FR-001 —
    "số nguyên, VND, > 0"; không có min/max theo Assumptions của spec).
  - `CreateTopUpRequestOutput`: `{ referenceCode: z.string(), amount: z.number(),
    bankAccountNumber: z.string(), bankName: z.string(), accountHolderName: z.string(),
    transferContent: z.string() }`.
  - `SepayWebhookPayload`: `{ id: z.coerce.string(), gateway: z.string(),
    transactionDate: z.string(), accountNumber: z.string(), content: z.string(),
    transferAmount: z.number().int(), transferType: z.string() }` (field theo đúng tên
    Sepay gửi — xem contracts/topup-api.md).
  - Export các type tương ứng qua `z.infer`.
- [X] T009 [US1] Tạo `src/routes/topup/topup.dto.ts`: `CreateTopUpRequestInputDTO`,
  `CreateTopUpRequestOutputDTO`, `SepayWebhookPayloadDTO` bằng `createZodDto(...)` wrap
  3 schema ở T008, theo đúng pattern `profile.dto.ts`.
- [X] T010 [P] [US1] Tạo `src/routes/topup/topup.repo.ts` (`@Injectable`, inject
  `PrismaService`). Theo đúng convention transaction-aware repo hiện có của
  `src/routes/auth/auth.repo.ts` (**không** tự mở `$transaction`/`TransactionService`
  trong repo — atomicity do `@Transactional()` ở service quyết định, xem T013): khai báo
  `private get prisma() { return this.prismaService.getClient(); }` và dùng `this.prisma`
  (không dùng `this.prismaService` trực tiếp) trong mọi method bên dưới, để tự động nối
  vào transaction đang chạy (nếu có) qua `TransactionContext`:
  - `createPendingRequest({ userId, referenceCode, requestedAmount })` → tạo
    `TopUpTransaction` với `status: 'PENDING'`.
  - `findByProviderTransactionId(providerTransactionId)` — dùng cho idempotency check
    (FR-005).
  - `findPendingByReferenceCode(referenceCode)` — chỉ match record `status: 'PENDING'`.
  - `markCredited({ topUpTransactionId, receivedAmount, providerTransactionId, rawContent })`
    → `this.prisma.topUpTransaction.update(...)` set `status: 'CREDITED'`,
    `receivedAmount`, `providerTransactionId`, `rawContent`, `creditedAt: new Date()`.
    **Không** tự mở transaction ở đây — caller (T013) PHẢI gọi method này và
    `incrementProfileBalance` dưới trong cùng một `@Transactional()`.
  - `incrementProfileBalance({ userId, amount })` → `this.prisma.profile.update(...)`
    với `balance: { increment: amount }` (data-model.md § Validation rules — "Cộng
    Profile.balance … chỉ xảy ra khi và chỉ khi một bản ghi chuyển sang CREDITED").
  - `createUnmatched({ receivedAmount, providerTransactionId, rawContent })` → tạo
    `TopUpTransaction` với `userId: null`, `requestedAmount: null`, `referenceCode: null`,
    `rawContent`, `status: 'UNMATCHED'` (FR-004 — `rawContent` bắt buộc, là manh mối duy
    nhất để xử lý tay vì không có admin UI ở v1).
- [X] T011 [P] [US1] Tạo `src/routes/topup/sepay-webhook.guard.ts`
  (`@Injectable() implements CanActivate`): đọc header `Authorization` của request, so
  khớp với `envConfig.SEPAY_WEBHOOK_API_KEY`; không khớp hoặc thiếu → log bằng `Logger`
  (mức `warn`, không log toàn bộ payload nhạy cảm) rồi `throw new
  UnauthorizedException()` (FR-010, research.md §2). Dùng so sánh hằng thời gian (ví dụ
  `crypto.timingSafeEqual` trên buffer cùng độ dài) để tránh timing attack lộ secret.
- [X] T012 [P] [US1] Tạo `src/routes/topup/sepay-api.client.ts` (`@Injectable`): method
  `listRecentTransactions(sinceMinutes: number)` gọi REST API liệt kê giao dịch của Sepay
  (`envConfig.SEPAY_API_BASE_URL`, header auth bằng `envConfig.SEPAY_API_TOKEN`), trả về
  mảng object cùng field với `SepayWebhookPayload` (T008) để tái dùng chung logic xử lý
  (research.md §6).
- [X] T013 [US1] Tạo `src/routes/topup/topup.service.ts` (`@Injectable`, inject
  `TopUpRepo`, `CACHE_PROVIDER` as `cacheProvider` (bắt buộc cho `@DistributedLock`, xem
  `profile.service.ts`), và `TransactionService` as `transactionService` — tên 2
  property PHẢI đúng `cacheProvider`/`transactionService` để `@DistributedLock`/
  `@Transactional()` hoạt động, xem `distributed-lock.decorator.ts`/
  `transactional.decorator.ts`):
  - `createTopUpRequest({ userId, amount })`: sinh `referenceCode` duy nhất (ví dụ
    8 ký tự alphanumeric viết hoa, retry nếu đụng unique constraint), gọi
    `topUpRepo.createPendingRequest`, trả về `CreateTopUpRequestOutput` ghép với thông
    tin ngân hàng tĩnh từ `envConfig` (FR-001).
  - `handleIncomingTransaction(payload: SepayWebhookPayloadType)`, bọc
    `@DistributedLock({ useCase: 'topup_incoming_transaction', resource: (payload) =>
    payload.id })`:
    1. Nếu `payload.transferType !== 'in'` → return sớm, không xử lý (contracts/topup-api.md).
    2. Nếu `topUpRepo.findByProviderTransactionId(payload.id)` đã tồn tại → return sớm,
       không cộng lại (FR-005 — idempotent, kể cả do webhook báo trùng hoặc do cron T015
       quét lại đúng giao dịch webhook đã xử lý).
    3. Tìm mã tham chiếu khớp trong `payload.content` trong số các `referenceCode` đang
       `PENDING`; khớp được → gọi `this.creditTopUp(...)` (private method bên dưới,
       FR-002/FR-003). Không khớp → `topUpRepo.createUnmatched({ receivedAmount,
       providerTransactionId: payload.id, rawContent: payload.content })` (FR-004).
  - `private creditTopUp({ topUpTransactionId, userId, receivedAmount,
    providerTransactionId, rawContent })`, **gắn `@Transactional()`** (theo đúng pattern
    `auth.service.ts` — `registerWithSession`, `loginWithSession`, …, KHÔNG để
    `topup.repo.ts` tự mở transaction, xem T010): gọi tuần tự
    `topUpRepo.markCredited(...)` rồi `topUpRepo.incrementProfileBalance({ userId,
    amount: receivedAmount })` — cả hai chạy trong cùng 1 DB transaction nhờ
    `TransactionContext` (data-model.md § Validation rules).
  - `handleIncomingTransaction` được gọi từ cả controller (webhook, T014) và cron job
    (T015) — đúng quyết định "tái dùng một logic xử lý" ở research.md §6.
- [X] T014 [P] [US1] Tạo `src/routes/topup/topup.controller.ts`
  (`@Controller('topups')`, `@ApiTags('Top-ups')`):
  - `POST /` — `@ApiBearerAuth('access-token')`, `@ActiveUser('userId') userId: string`,
    body `CreateTopUpRequestInputDTO`, trả `CreateTopUpRequestOutputDTO` — gọi
    `topupService.createTopUpRequest` (route Bearer thường, có permission record theo
    Nguyên tắc II).
  - `POST /sepay/webhook` — `@IsPublic()` + `@UseGuards(SepayWebhookGuard)`, body
    `SepayWebhookPayloadDTO`, gọi `topupService.handleIncomingTransaction`, trả
    `{ success: true }` (contracts/topup-api.md).
- [X] T015 [P] [US1] Tạo `src/routes/topup/topup.cron.ts` (`@Injectable`, inject
  `SepayApiClient`, `TopUpService`): method có `@Cron(CronExpression.EVERY_5_MINUTES)`
  hoặc biểu thức cron build từ `envConfig.SEPAY_RECONCILE_INTERVAL_MINUTES` — gọi
  `sepayApiClient.listRecentTransactions(...)`, với mỗi giao dịch trả về gọi
  `topupService.handleIncomingTransaction(...)` (FR-011; `handleIncomingTransaction` đã
  tự idempotent ở bước 2 của T013 nên không cộng lại giao dịch cron quét trùng webhook).
- [X] T016 [US1] Tạo `src/routes/topup/topup.module.ts` khai báo
  `providers: [TopUpService, TopUpRepo, SepayWebhookGuard, SepayApiClient, TopUpCron]`,
  `controllers: [TopUpController]`; import `TopUpModule` vào mảng `imports` của
  `src/app.module.ts` (cạnh `ProfileModule`).
- [X] T017 [US1] Chạy `npm run seed:permissions` (script `src/seed/create-permissions.ts`,
  không cần sửa code — script tự quét decorator route); xác nhận một permission record
  mới cho `POST /api/v1/topups` được tạo trong DB và role-permission cache đã được
  invalidate (Nguyên tắc II) — route `POST /topups/sepay/webhook` là `@IsPublic()` nên
  không cần permission để truy cập nhưng vẫn được script quét/lưu như mọi route khác.

**Checkpoint**: User Story 1 hoạt động độc lập — xem `quickstart.md` Scenario 1-5.

---

## Phase 4: User Story 2 - Xem số dư hiện tại (Priority: P2)

**Goal**: User xem được số dư hiện tại (đã được cộng ở US1) trên trang hồ sơ cá nhân.

**Independent Test**: sau khi một `TopUpTransaction` đã ở trạng thái `CREDITED` (có thể
tạo thẳng bằng seed/fixture, không cần chạy lại toàn bộ US1), gọi `GET /profiles/me` và
xác nhận response có field `balance` đúng giá trị.

### Implementation for User Story 2

- [X] T018 [US2] Trong `src/routes/profile/profile.model.ts`: thêm `balance: true` vào
  `Profile.pick({...})` của `ProfileOutput`, rồi `.extend({ balance: z.bigint().transform(Number)
  })` để field serialize đúng qua JSON/Swagger — `BigInt` không tự serialize được bằng
  `JSON.stringify` (`ZodSerializerInterceptor`/`CustomZodSerializerInterceptor` sẽ parse
  response qua schema này, nên transform phải nằm ở đây — xem
  `src/shared/interceptors/custom-zod.interceptor.ts`). Không cần sửa
  `profile.repo.ts`/`profile.service.ts` — `getMe` đã `findFirst` không giới hạn `select`
  nên `balance` tự có trong object trả về (FR-007).

**Checkpoint**: Cả US1 và US2 hoạt động độc lập — số dư hiển thị đúng sau khi nạp tiền.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Cổng chất lượng chuẩn của repo (Nguyên tắc IV) + xác nhận thủ công toàn bộ
quickstart trước khi coi feature là xong.

- [X] T019 [P] Chạy `npm run lint` (oxlint type-aware) trên toàn bộ code mới ở
  `src/routes/topup/`, `src/entities/topup-transaction.model.ts`,
  `src/routes/profile/profile.model.ts`, `src/shared/config.ts`, `src/app.module.ts`;
  sửa mọi lỗi (đặc biệt `typescript/no-floating-promises` trên method của
  `topup.cron.ts`/`topup.service.ts`).
- [X] T020 [P] Chạy `npm test` (vitest) và `npm run build`, đảm bảo pass trước khi coi
  task xong (Nguyên tắc IV).
- [X] T021 Thực hiện bằng tay **cả 5 scenario** trong
  `specs/002-sepay-wallet-topup/quickstart.md` trên môi trường dev local — tất cả 5 đều
  bắt buộc trước khi coi feature xong (không scenario nào là optional, kể cả Scenario 5 —
  đối soát chủ động, vì FR-011/SC-006 là yêu cầu bắt buộc của spec, không phải nice-to-have);
  xác nhận kết quả khớp đúng "Kỳ vọng" của từng scenario.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: không phụ thuộc gì — bắt đầu ngay.
- **Foundational (Phase 2)**: phụ thuộc Setup xong — CHẶN cả US1 và US2.
- **User Story 1 (Phase 3)**: phụ thuộc Foundational xong. Không phụ thuộc US2.
- **User Story 2 (Phase 4)**: phụ thuộc Foundational xong. Không phụ thuộc US1 về code
  (chỉ cần field `balance` đã tồn tại từ Foundational) — có thể làm song song với Phase 3
  nếu có 2 người, nhưng để test độc lập "thật" (balance > 0) cần có ít nhất 1 bản ghi
  `CREDITED` do US1 tạo ra (hoặc fixture thủ công như ghi ở Independent Test).
- **Polish (Phase 5)**: phụ thuộc cả US1 và US2 xong.

### Trong từng User Story

**US1**: T007/T008/T010/T011/T012 độc lập file nhau → có thể song song. T009 phụ thuộc
T008. T013 phụ thuộc T010, T011 (dùng gián tiếp qua controller), T012. T014 phụ thuộc
T009, T013. T015 phụ thuộc T012, T013, T002 (ScheduleModule). T016 phụ thuộc toàn bộ
T007-T015. T017 phụ thuộc T016 (route `POST /topups` phải tồn tại để seed quét được).

**US2**: chỉ T018, không có task phụ thuộc khác ngoài Foundational T006.

### Parallel Opportunities

- Setup: T001, T002 song song.
- Foundational: T005, T006 song song (sau T004).
- US1: T007, T008, T010, T011, T012 song song (sau Foundational); T014 và T015 song song
  với nhau (sau T013, khác file).
- US1 (Phase 3) và US2 (Phase 4) có thể làm song song bởi 2 người khác nhau — không đụng
  file nhau (`src/routes/topup/**` vs `src/routes/profile/profile.model.ts`).
- Polish: T019, T020 song song; T021 làm sau cùng (cần cả hai story chạy được).

---

## Parallel Example: User Story 1

```bash
# Sau khi Foundational (Phase 2) xong, chạy song song:
Task: "Tạo src/entities/topup-transaction.model.ts (T007)"
Task: "Tạo src/routes/topup/topup.model.ts (T008)"
Task: "Tạo src/routes/topup/topup.repo.ts (T010)"
Task: "Tạo src/routes/topup/sepay-webhook.guard.ts (T011)"
Task: "Tạo src/routes/topup/sepay-api.client.ts (T012)"

# Sau khi topup.service.ts (T013) xong, chạy song song:
Task: "Tạo src/routes/topup/topup.controller.ts (T014)"
Task: "Tạo src/routes/topup/topup.cron.ts (T015)"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 (Setup) → Phase 2 (Foundational) — bắt buộc, chặn mọi story.
2. Phase 3 (US1) — đây là MVP thật của tính năng (nạp tiền tự động); US2 chỉ là "xem lại"
   giá trị US1 đã tạo ra.
3. Dừng lại, chạy Scenario 1-4 của `quickstart.md` để xác nhận US1 chạy đúng độc lập.

### Incremental Delivery

1. Setup + Foundational xong → nền tảng sẵn sàng.
2. US1 xong → demo được: tạo yêu cầu nạp tiền, giả lập webhook, số dư cộng đúng (cần xem
   DB trực tiếp vì chưa có US2).
3. US2 xong → demo đầy đủ: user tự xem được số dư trên API `GET /profiles/me`.
4. Polish → chạy lint/test/build + toàn bộ quickstart trước khi merge.

### Complexity ghi chú

Không có task nào thuộc Complexity Tracking của `plan.md` (không có vi phạm constitution
cần biện minh).
