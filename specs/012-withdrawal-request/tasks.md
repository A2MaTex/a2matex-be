---

description: "Danh sách việc — Tạo đơn rút tiền cho nhà phát hành"
---

# Tasks: Tạo đơn rút tiền cho nhà phát hành

**Input**: Design documents từ `/specs/012-withdrawal-request/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/withdrawal-api.md](./contracts/withdrawal-api.md)

**Tests**: **CÓ** — chủ repo yêu cầu viết và chạy unit test đầy đủ (2026-11-27), nhưng **KHÔNG
commit** (xem T002 và research.md R11).

**Organization**: nhóm theo user story để mỗi story chạy và kiểm được độc lập.

## Format: `[ID] [P?] [Story] Mô tả`

- **[P]**: chạy song song được (file khác nhau, không phụ thuộc nhau)
- **[Story]**: US1 / US2 / US3

---

## Phase 1: Setup

**Purpose**: chuẩn bị chỗ làm việc

- [X] T001 Xác nhận đang ở nhánh `feat/withdrawal-request` và DB local sạch: chạy `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --config prisma7.config.ts` phải in `No difference detected`
- [X] T002 Thêm vào `.gitignore` dòng `src/routes/withdrawal/test/` kèm comment `# Unit test module tiền: chạy ở local, không lên CI (specs/012-withdrawal-request/research.md R11)`

---

## Phase 2: Foundational (chặn mọi user story)

**Purpose**: database, sổ cái và khung module — chưa làm xong thì không story nào bắt đầu được

**⚠️ KHÔNG user story nào được bắt đầu trước khi phase này xong**

### Database

- [X] T003 Viết migration 1 `prisma/migrations/<timestamp>_add_withdrawal_enum_values/migration.sql` **CHỈ** chứa `ALTER TYPE "WalletTransactionType" ADD VALUE 'WITHDRAWAL';` và `ALTER TYPE "WalletTransactionType" ADD VALUE 'WITHDRAWAL_REVERSAL';` — **không thêm gì khác** (R1: Prisma bọc file trong transaction, dùng giá trị enum vừa thêm trong cùng transaction sẽ gãy)
- [X] T004 Viết migration 2 `prisma/migrations/<timestamp>_add_withdrawal_request/migration.sql` tạo `CREATE TYPE "WithdrawalRequestStatus" AS ENUM ('PENDING','APPROVED','REJECTED','PAID','CANCELLED')` và bảng `WithdrawalRequest` theo data-model.md §1: `id UUID PK gen_random_uuid()`, `publisherUserId UUID NOT NULL FK→User(id)`, `amount BIGINT NOT NULL CHECK (amount > 0)`, `status WithdrawalRequestStatus NOT NULL DEFAULT 'PENDING'`, `bankAccountNumber VARCHAR(50) NOT NULL`, `bankName VARCHAR(255) NOT NULL`, `bankAccountHolder VARCHAR(255) NOT NULL`, `idempotencyKey UUID NOT NULL`, `bankTransferRef TEXT NULL`, `rejectionReason TEXT NULL`, `createdAt TIMESTAMPTZ NOT NULL DEFAULT now()`, `processedAt TIMESTAMPTZ NULL`, `processedById UUID NULL FK→User(id)`. **Không có cột `deletedAt`**
- [X] T005 Trong `prisma/migrations/<timestamp>_add_withdrawal_request/migration.sql`, thêm 3 check constraint của bảng theo data-model.md §1: `WithdrawalRequest_processed_check` (status='PENDING' ⇔ processedAt IS NULL), `WithdrawalRequest_transferRef_check` (bankTransferRef IS NULL OR status='PAID'), `WithdrawalRequest_rejection_check` (rejectionReason IS NULL OR status='REJECTED')
- [X] T006 Trong `prisma/migrations/<timestamp>_add_withdrawal_request/migration.sql`, thêm 2 index: `CREATE UNIQUE INDEX "WithdrawalRequest_publisher_idempotency_key" ON "WithdrawalRequest" ("publisherUserId","idempotencyKey")` và `CREATE INDEX "WithdrawalRequest_publisher_createdAt_idx" ON "WithdrawalRequest" ("publisherUserId","createdAt" DESC)`
- [X] T007 Trong `prisma/migrations/<timestamp>_add_withdrawal_request/migration.sql`, thêm cột `withdrawalRequestId UUID REFERENCES "WithdrawalRequest"(id) ON DELETE NO ACTION` vào `WalletTransaction`, kèm `CREATE UNIQUE INDEX "WalletTransaction_withdrawal_type_key" ON "WalletTransaction" ("withdrawalRequestId", type) WHERE "withdrawalRequestId" IS NOT NULL` và `CREATE INDEX "WalletTransaction_withdrawal_idx" ... WHERE "withdrawalRequestId" IS NOT NULL`
- [X] T008 Trong `prisma/migrations/<timestamp>_add_withdrawal_request/migration.sql`, DROP rồi tạo lại `WalletTransaction_accountKind_check` thêm **2 nhánh**: `(type='WITHDRAWAL' AND direction='DEBIT' AND "userId" IS NOT NULL)` và `(type='WITHDRAWAL_REVERSAL' AND direction='CREDIT' AND "userId" IS NOT NULL)`
- [X] T009 Trong `prisma/migrations/<timestamp>_add_withdrawal_request/migration.sql`, DROP rồi tạo lại `WalletTransaction_source_check` theo **nguyên văn** data-model.md §3.4 — **mỗi nhánh cũ phải thêm `"withdrawalRequestId" IS NULL`**, không chỉ thêm nhánh mới (R6: nếu không, một dòng `ADMIN_GRANT` vẫn mang được `withdrawalRequestId` mà ràng buộc cho qua — bẫy im lặng, không test nào fail)
- [X] T010 Xác nhận `prisma/migrations/<timestamp>_add_withdrawal_request/migration.sql` **KHÔNG** chứa thay đổi nào cho `WalletTransaction_actor_check`, và chạy `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'WalletTransaction_actor_check'` để kiểm ràng buộc vẫn chỉ liệt kê `ADMIN_GRANT` và `ISSUED_CREDIT` (R7: thêm `WITHDRAWAL_REVERSAL` vào danh sách bắt buộc có `createdById`+`note` sẽ chặn đúng đường publisher tự huỷ, vì ca đó không có admin nào)
- [X] T011 Cập nhật `prisma/schema.prisma`: model `WithdrawalRequest`, enum `WithdrawalRequestStatus`, 2 giá trị enum mới của `WalletTransactionType`, cột + quan hệ mới trên `WalletTransaction`. Sửa **bằng tay**, không `introspect`
- [X] T012 Chạy `npm run prisma:migrate:deploy` rồi `npm run prisma:generate`; xác nhận `prisma migrate diff` in `No difference detected`

### Sổ cái

- [X] T013 [P] Thêm `WITHDRAWAL` và `WITHDRAWAL_REVERSAL` vào `WalletTransactionType`, và mở rộng `WALLET_ENTRY_SHAPES` từ 7 lên **9** tổ hợp trong `src/shared/constants/wallet.constant.ts`
- [X] T014 Thêm `tryDebitUserBalance({userId, amount})` vào `src/routes/wallet/wallet.repo.ts` theo khuôn `tryDebitSystemAccount`: điều kiện `balance >= amount` và `deletedAt IS NULL` nằm **trong chính câu lệnh `UPDATE`**, trả về `balance` từ `updateManyAndReturn`, `null` khi không khớp dòng nào (R9 — để `CHECK` của database bắt thì thành 500)
- [X] T015 Thêm `recordWithdrawal({userId, withdrawalRequestId, amount, balanceAfter})` và `recordWithdrawalReversal(...)` vào `src/routes/wallet/wallet.service.ts`, theo khuôn `recordPurchase`/`recordEarning`: giữ guard `isNoop`, **không** tự mở transaction (chạy trong transaction của module gọi)
- [X] T016 Thêm `withdrawalRequestId` vào type `WalletEntryInput` và vào `insertEntry` trong `src/routes/wallet/wallet.repo.ts`

### Cấu hình

- [X] T017 [P] Thêm khoá `WITHDRAWAL_MIN_AMOUNT` vào `src/shared/constants/system-setting.constant.ts`
- [X] T018 Khai `WITHDRAWAL_MIN_AMOUNT` trong `src/routes/system-setting/system-setting.registry.ts` với schema `{ amount: <chuỗi thập phân> }` **có kiểm trần BIGINT** — không dùng `^\d{1,19}$` trần trụi (R5: regex đó cho qua `9999999999999999999` → 22003 → 500)
- [X] T019 [P] ~~Thêm giá trị khởi tạo vào `src/seed/seed-system-settings.ts`~~ → **làm trong migration 2 thay thế**. `seed-system-settings.ts` CHỈ bắc cầu 3 giá trị ngân hàng từ biến môi trường, nó không tạo dòng `SystemSetting` mới; dòng cấu hình được tạo bằng `INSERT` trong migration, giống hệt `COMMISSION_RATE_BPS` ở `20261123170000_add_system_setting`

### Khung module

- [X] T020 [P] Tạo `src/entities/withdrawal-request.model.ts` với `WithdrawalRequestStatusSchema` (5 giá trị)
- [X] T021 [P] Tạo `src/shared/constants/withdrawal.constant.ts`: `WithdrawalRequestStatus`, `WITHDRAWAL_PAGE_SIZE_MAX = 100` (bằng `WALLET_PAGE_SIZE_MAX`), `WITHDRAWAL_COOLDOWN_HOURS = 24` (hằng số trong mã nguồn — **cố ý** không đưa vào `SystemSetting`, xem research.md R3a)
- [X] T022 [P] Tạo `src/routes/withdrawal/withdrawal.error.ts` đủ 9 exception theo contracts: `WithdrawalIdempotencyKeyReused` (409), `WithdrawalAmountInvalid` (422), `WithdrawalBelowMinimum` (422), `WithdrawalInsufficientBalance` (422), `WithdrawalCooldownActive` (422), `WithdrawalMinAmountUnavailable` (503), `WithdrawalProfileNotFound` (404), `WithdrawalNotFound` (404), `WithdrawalNotPending` (409)
- [X] T023 Tạo `src/routes/withdrawal/withdrawal.model.ts` với các schema ở data-model.md §5, gồm **hai** schema output riêng: `WithdrawalOutput` (cho 2 route đọc) và `WithdrawalMutationOutput` = `WithdrawalOutput` + `balanceAfter` (**chỉ** cho tạo đơn và huỷ đơn). Output dùng `zBigIntAsString()` thì type phải là `z.input<typeof X>` **không phải** `z.infer`
- [X] T024 Tạo `src/routes/withdrawal/withdrawal.dto.ts` bằng `createZodDto` cho từng schema ở T023
- [X] T025 Tạo `src/routes/withdrawal/withdrawal.module.ts` import `PublisherModule`, `WalletCoreModule`, `SystemSettingCoreModule` (bản `*Core` không mang controller), và đăng ký `WithdrawalModule` trong `src/app.module.ts`

**Checkpoint**: database, sổ cái, cấu hình và khung module sẵn sàng — user story bắt đầu được

---

## Phase 3: User Story 1 — Nhà phát hành tạo đơn rút tiền (P1) 🎯 MVP

**Goal**: publisher có số dư tạo được đơn rút tiền; tiền bị trừ ngay và sổ cái ghi đúng một bút toán

**Independent Test**: đăng nhập publisher có số dư → `POST /withdrawals` → kiểm 3 thứ: đơn ở
`PENDING`, `Profile.balance` giảm đúng số tiền, sổ cái có đúng 1 dòng `WITHDRAWAL/DEBIT`

### Tests for User Story 1 ⚠️

> Viết trước, chạy phải FAIL trước khi hiện thực. Tất cả nằm trong `src/routes/withdrawal/test/` — **không commit** (T002)

- [X] T026 [P] [US1] Test hàm thuần `sameClaim` trong `src/routes/withdrawal/test/withdrawal-claim.spec.ts`: khớp cả 4 trường ⇒ true; đổi **từng** trường một (amount, bankAccountNumber, bankName, bankAccountHolder) ⇒ false
- [X] T027 [P] [US1] Test hàm tính mốc 24 giờ trong `src/routes/withdrawal/test/withdrawal-cooldown.spec.ts`: không có đơn trước ⇒ cho phép; đơn cách 23h59m ⇒ chặn kèm thời điểm sớm nhất; đơn cách đúng 24h ⇒ cho phép
- [X] T028 [P] [US1] Test schema số tiền trong `src/routes/withdrawal/test/withdrawal-amount.spec.ts`: `"0"`, `"-1"`, `"abc"`, `"9999999999999999999"` (vượt trần BIGINT) đều bị từ chối; `"100000"` qua
- [X] T029 [US1] Test `WithdrawalService.create` với repo giả trong `src/routes/withdrawal/test/withdrawal.service.spec.ts`: thiếu số dư ⇒ `WithdrawalInsufficientBalance`; dưới mức tối thiểu ⇒ `WithdrawalBelowMinimum`; chưa đủ 24h ⇒ `WithdrawalCooldownActive`; khoá lặp trùng nội dung ⇒ trả đơn cũ; khoá lặp khác nội dung ⇒ `WithdrawalIdempotencyKeyReused`

### Implementation for User Story 1

- [X] T030 [US1] Khai type `WithdrawalClaim` (4 trường: `amount: bigint`, `bankAccountNumber`, `bankName`, `bankAccountHolder`) cùng `toClaim()` và `sameClaim()` trong `src/routes/withdrawal/withdrawal.model.ts` — dùng **cùng một** type cho cả `INSERT` lẫn phép so, để thêm trường mới là TypeScript báo lỗi ở mọi chỗ (R4)
- [X] T031 [US1] Tạo `src/routes/withdrawal/withdrawal.repo.ts` với `lockPublisherProfile(userId)` dùng SQL thô `SELECT ... FROM "Profile" WHERE "userId" = $1 AND "deletedAt" IS NULL FOR UPDATE` — **khoá Profile luôn trước, là khoá duy nhất lúc tạo đơn** (R2)
- [X] T032 [US1] Thêm `findByIdempotencyKey({publisherUserId, idempotencyKey})` vào `withdrawal.repo.ts`
- [X] T033 [US1] Thêm `findCooldownState(publisherUserId)` vào `src/routes/withdrawal/withdrawal.repo.ts` trả `{ lastCreatedAt, dbNow, nextAllowedAt }` trong **một** câu truy vấn dùng `now()` **của database** — **không** so với `new Date()` của ứng dụng (research.md R3: app container và Cloud SQL lệch đồng hồ được, lệch vài giây ở ranh giới 24 giờ là cho qua/chặn nhầm). `nextAllowedAt` chính là giá trị trả cho người dùng theo FR-015. **KHÔNG `FOR UPDATE`** **KHÔNG `FOR UPDATE`** (R3: khoá Profile đã serialize rồi; thêm khoá ở đây tạo chu trình với đường huỷ đơn → deadlock 40P01) và **không lọc trạng thái** (FR-014: mọi đơn đều tính)
- [X] T034 [US1] Thêm `createRequest(...)` vào `withdrawal.repo.ts` trả về id và `createdAt` từ chính câu `INSERT`
- [X] T035 [US1] Thêm `findOneForPublisher({withdrawalId, publisherUserId})` vào `withdrawal.repo.ts` — lọc theo `publisherUserId` ngay trong `WHERE`, không khớp ⇒ `null` (FR-036)
- [X] T036 [US1] Viết `readMinAmount()` trong `src/routes/withdrawal/withdrawal.service.ts`: đọc setting **trong transaction, không cache**; lỗi cấu hình ⇒ `WithdrawalMinAmountUnavailable` (503), nhưng **lỗi Prisma phải ném nguyên dạng** (R/FR-012a — theo đúng `order.service.ts:62-79`)
- [X] T037 [US1] Viết `WithdrawalService.create()` trong `withdrawal.service.ts`: gọi `assertActivePublisher()` **trước khi mở transaction**, rồi probe chống lặp (chốt 1), rồi vào `@Transactional()`. Thứ tự trong transaction theo data-model.md §7: khoá Profile → probe chốt 2 → đọc mức tối thiểu → kiểm tối thiểu → kiểm 24 giờ → `tryDebitUserBalance` → `createRequest` → `recordWithdrawal`. **Probe chống lặp phải chạy TRƯỚC kiểm 24 giờ** (FR-016a)
- [X] T038 [US1] Thêm probe chống lặp lần 3 trong khối `catch` của `create()` trước khi ném lỗi (R4 chốt 3: request thua cuộc thường vấp quy tắc nghiệp vụ trước khi vấp khoá lặp — theo `order.service.ts:103`)
- [X] T039 [US1] Trong `src/routes/withdrawal/withdrawal.service.ts`, inject `TransactionService` vào constructor **đúng tên `transactionService`** — `@Transactional()` đọc `this.transactionService` và ném lỗi lúc chạy nếu thiếu (build vẫn xanh)
- [X] T040 [US1] Tạo `src/routes/withdrawal/withdrawal.controller.ts` với `POST /withdrawals`: `@HttpCode(200)`, `@ApiHeader(IDEMPOTENCY_KEY_HEADER)`, `@IdempotencyKey('Error.WithdrawalIdempotencyKeyRequired')`, `@ActiveUser('userId')`, `@SkipPermissionCheck()`
- [X] T041 [US1] Thêm log có cấu trúc trong `create()` theo khuôn `order.service.ts:330`: ghi `withdrawalId`, `publisherUserId`, `amount` lúc thành công; ghi `logger.warn` kèm lý do cho mỗi đường từ chối

**Checkpoint**: US1 chạy độc lập được — publisher tạo được đơn, tiền trừ đúng, sổ cái đúng 1 dòng

---

## Phase 4: User Story 2 — Nhà phát hành xem lại đơn của mình (P2)

**Goal**: publisher xem được danh sách và chi tiết đơn của chính mình

**Independent Test**: tạo vài đơn → `GET /withdrawals/me` kiểm phân trang và thứ tự mới-nhất-trước;
`GET /withdrawals/:id` của publisher khác ⇒ 404 giống hệt id không tồn tại

### Tests for User Story 2 ⚠️

- [X] T042 [P] [US2] Test `WithdrawalService.listMine` và `findOne` với repo giả trong `src/routes/withdrawal/test/withdrawal-read.spec.ts`: phân trang tính đúng `totalPages`; `findOne` với đơn của người khác ⇒ `WithdrawalNotFound` (cùng exception với id không tồn tại)

### Implementation for User Story 2

- [X] T043 [US2] Thêm `listMine({publisherUserId, skip, take})` vào `src/routes/withdrawal/withdrawal.repo.ts` trả **mọi** trạng thái kể cả `CANCELLED` (không lọc), sắp xếp `ORDER BY "createdAt" DESC, id ASC` — `createdAt` một mình **không phải thứ tự toàn phần** vì cột mặc định `now()` là thời điểm bắt đầu transaction (cùng quy ước `order.repo.ts:236`)
- [X] T044 [US2] Viết `WithdrawalService.listMine()` dùng `getPagination` từ `src/shared/utils/pagination.ts`, trả khoá **`items`** chứ không phải `data` (`transform.interceptor.ts` đã tự bọc `{data:...}`)
- [X] T045 [US2] Viết `WithdrawalService.findOne()` trong `src/routes/withdrawal/withdrawal.service.ts` — đơn của publisher khác trả **đúng cùng** `WithdrawalNotFound` với id không tồn tại (FR-036)
- [X] T046 [US2] Thêm `GET /withdrawals/me` và `GET /withdrawals/:withdrawalId` vào controller. **`me` phải khai TRƯỚC `:withdrawalId`** — Nest khớp theo thứ tự khai báo, ngược lại thì `"me"` bị đọc thành id rồi fail kiểm UUID (`order.controller.ts:41`)

**Checkpoint**: US1 và US2 đều chạy độc lập

---

## Phase 5: User Story 3 — Nhà phát hành huỷ đơn đang chờ duyệt (P3)

**Goal**: publisher tự huỷ đơn `PENDING`; tiền trả về ví và sổ cái ghi bút toán đảo

**Independent Test**: tạo đơn → huỷ → số dư trở về mức ban đầu và sổ cái có đủ **2** bút toán ngược
chiều gắn cùng một đơn

### Tests for User Story 3 ⚠️

- [X] T047 [P] [US3] Test `WithdrawalService.cancel` với repo giả trong `src/routes/withdrawal/test/withdrawal-cancel.spec.ts`: `UPDATE` khớp 0 dòng và đơn không tồn tại ⇒ `WithdrawalNotFound`; khớp 0 dòng nhưng đơn tồn tại và là của mình ⇒ `WithdrawalNotPending`; khớp 1 dòng ⇒ cộng trả + ghi bút toán đảo **đúng một lần**

### Implementation for User Story 3

- [X] T048 [US3] Thêm `cancelIfPending({withdrawalId, publisherUserId})` vào `withdrawal.repo.ts` dùng **một câu lệnh duy nhất**: `UPDATE "WithdrawalRequest" SET status='CANCELLED', "processedAt"=now() WHERE id=$1 AND "publisherUserId"=$2 AND status='PENDING' RETURNING id, amount`. **Không được tách thành `SELECT ... FOR UPDATE` rồi `UPDATE`** (R8: điều kiện nằm trong câu lệnh thì không còn cửa sổ để chen vào; tách ra là phụ thuộc vào việc nhớ đặt `FOR UPDATE`, quên là 500 trên đường tiền)
- [X] T049 [US3] Viết `WithdrawalService.cancel()` trong `@Transactional()`: khoá Profile trước (giữ thứ tự khoá toàn cục R2) → `cancelIfPending` → nếu 0 dòng thì đọc lại đơn **chỉ để chọn thông điệp lỗi** 404 hay 409 → `creditUserBalance` (hàm đã có sẵn ở `wallet.repo.ts:111`) → `recordWithdrawalReversal`
- [X] T050 [US3] Thêm `POST /withdrawals/:withdrawalId/cancel` vào `src/routes/withdrawal/withdrawal.controller.ts` — dùng `POST .../cancel` chứ **không** `DELETE`: đơn không bị xoá, nó đổi trạng thái và để lại bút toán
- [X] T051 [US3] Thêm ca 34 vào `specs/012-withdrawal-request/quickstart.md`: gửi lại `POST /withdrawals` với đúng khoá chống lặp của một **đơn đã huỷ** ⇒ trả về chính đơn `CANCELLED` đó, **không** tạo đơn mới, **không** trừ tiền (contracts §Dùng lại khoá chống lặp sau khi đã huỷ)

**Checkpoint**: cả ba user story chạy độc lập

---

## Phase 6: Polish & Cross-Cutting

- [X] T052 [P] Cập nhật phép đối soát **(e)** trong `docs/deployment-runbook.md` sang dạng **hai túi** theo research.md R10: `tiền mặt + tự phát hành − đã chi thật = nợ người dùng + ví sàn + đang chờ chi`, với `đã chi thật` = tổng đơn `PAID` và `đang chờ chi` = tổng đơn `PENDING`+`APPROVED`. **Đừng dùng bản một-số-hạng** — nó coi lúc tạo đơn là lúc tiền rời hệ thống nên báo thiếu đúng bằng tổng đơn chưa chi
- [X] T053 [P] Thêm phép đối soát **(f)** vào `docs/deployment-runbook.md` theo data-model.md §8: tổng đơn chưa hoàn phải bằng `SUM(WITHDRAWAL) − SUM(WITHDRAWAL_REVERSAL)`
- [X] T054 [P] Thêm mục deploy cho spec 012 vào `docs/deployment-runbook.md`, ghi rõ **KHÔNG cần chạy `seed-permissions`** cho lần deploy này (FR-038a) và lý do: 4 route dùng `@SkipPermissionCheck()`; chạy thừa sẽ xoá cache phân quyền không-TTL và làm lộ grant đã mất — đúng sự cố 403 ngày 2026-11-23
- [X] T055 Chạy toàn bộ 34 ca trong [quickstart.md](./quickstart.md) trên `dist` (`npm run build && node dist/main.js`), **không dùng `start:dev`** (tsx không emit decorator metadata nên DTO không được validate)
- [X] T056 Kiểm 2 migration áp sạch trên **database rỗng** (Nguyên tắc III) và áp lại lần hai không nhân đôi gì
- [X] T057 `npm run lint` + `npm test` + `npm run build` đều xanh; nếu `TS2694 ... has no exported member` thì chạy `npm run prisma:generate` rồi build lại
- [X] T058 Chạy `git status --short` xác nhận **không** có file test nào được liệt kê — dòng `.gitignore` ở T002 đang chặn đúng

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: không phụ thuộc gì
- **Phase 2 Foundational**: sau Setup — **CHẶN mọi user story**
- **Phase 3-5 User Stories**: sau Foundational. Làm tuần tự theo ưu tiên P1 → P2 → P3, hoặc song song nếu đủ người
- **Phase 6 Polish**: sau khi các story cần thiết đã xong

### Trong Phase 2 (thứ tự bắt buộc)

```
T003 (enum) → T004-T010 (bảng + ràng buộc) → T011 (schema.prisma) → T012 (deploy + generate)
                                                                        ↓
                                                      T013-T016 (sổ cái) ─┤
                                                      T017-T019 (cấu hình)─┼→ T020-T025 (khung)
```

T003 **phải** là file migration riêng và chạy trước T004 — không gộp được (R1).

### User Story Dependencies

- **US1 (P1)**: chỉ phụ thuộc Foundational. Là MVP
- **US2 (P2)**: chỉ phụ thuộc Foundational. Kiểm được độc lập, nhưng cần vài đơn để xem — tạo bằng US1 hoặc chèn thẳng vào database
- **US3 (P3)**: chỉ phụ thuộc Foundational. Cần một đơn `PENDING` để huỷ

### Parallel Opportunities

- **Phase 2**: T013 ∥ T017 ∥ T019 ∥ T020 ∥ T021 ∥ T022 (file khác nhau). T014-T016 cùng đụng `wallet.repo.ts`/`wallet.service.ts` nên **tuần tự**
- **Phase 3**: T026 ∥ T027 ∥ T028 (3 file test khác nhau). T031-T035 cùng đụng `withdrawal.repo.ts` nên **tuần tự**
- **Phase 6**: T051 ∥ T053 ∥ T054 (cùng file runbook nhưng khác mục — làm tuần tự nếu sợ xung đột)

---

## Implementation Strategy

### MVP (chỉ US1)

1. Phase 1 Setup
2. Phase 2 Foundational — **chặn tất cả, làm cho xong**
3. Phase 3 US1
4. **DỪNG VÀ KIỂM**: chạy ca 1-3, 8-15, 19-21, 23-27 trong quickstart
5. Tới đây publisher đã rút được tiền — phần còn lại là tiện lợi

### Giao từng phần

1. Setup + Foundational → nền sẵn sàng
2. + US1 → kiểm độc lập → **MVP**
3. + US2 → publisher xem được trạng thái đơn
4. + US3 → publisher tự sửa sai được
5. + Polish → đối soát và runbook đúng

---

## Notes

- **Không commit file test** — T002 đã chặn bằng `.gitignore`, T058 kiểm lại trước khi mở PR
- Ba chỗ dễ sai nhất, đều đã có task riêng: **T009** (viết lại toàn bộ `source_check`), **T048**
  (một câu `UPDATE` có điều kiện, không tách `SELECT`+`UPDATE`), **T037** (probe chống lặp trước
  kiểm 24 giờ)
- **T010 là một task "không làm gì"** — cố ý, để người hiện thực không tự thêm
  `WITHDRAWAL_REVERSAL` vào `actor_check`
- Commit sau mỗi task hoặc mỗi nhóm hợp lý; dừng ở checkpoint để kiểm từng story độc lập
