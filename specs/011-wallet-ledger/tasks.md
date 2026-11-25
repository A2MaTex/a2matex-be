---

description: "Task list for wallet ledger and platform money account"
---

# Tasks: Sổ cái ví và tài khoản tiền của sàn

**Input**: Design documents from `specs/011-wallet-ledger/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Spec không yêu cầu TDD. Theo [research.md](./research.md) R15, unit test viết cho phần tính toán thuần nhưng **không commit** (quyết định của chủ repo ở PR #50). Verify chính thức theo [quickstart.md](./quickstart.md). Task test nằm ở Phase 9, đánh dấu rõ là không commit.

**Organization**: gom theo user story. Nhưng đọc kỹ mục Dependencies — **US1 và US2 cùng sửa `order.service.ts`**, và US5 cần tiền trong tài khoản của sàn nên phụ thuộc US2 hoặc US6.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác file, không phụ thuộc task chưa xong)
- **[Story]**: US1–US6 theo spec.md

## Path Conventions

Web service, NestJS module hoá theo `src/routes/`. Mọi đường dẫn tính từ gốc repo.

---

## Phase 1: Setup

**Purpose**: dựng chỗ làm việc, chưa đụng tới logic

- [X] T001 Xác nhận `.env` có `DATABASE_URL` trỏ `localhost` và đối chiếu với `POSTGRES_HOST` — chạy `grep -E '^(DATABASE_URL|POSTGRES_HOST)=' .env`; hai biến lệch nhau đã từng làm lệnh chạy vào nhầm database
- [X] T002 Dựng database local: `npm run compose-up`, rồi `npm run prisma:migrate:deploy` để đưa về trạng thái hiện tại trước khi thêm migration mới
- [X] T003 Tạo thư mục migration rỗng bằng `npm run prisma:migrate:create -- --name add_wallet_ledger`, giữ nguyên `migration.sql` rỗng để các task sau ghi vào

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: bảng, enum, ràng buộc và lõi ghi sổ. Không user story nào bắt đầu được trước khi xong phase này.

**⚠️ CRITICAL**: toàn bộ Phase 2 phải xong trước khi sang Phase 3

### Migration — phần DDL

- [X] T004 Ghi 3 `CREATE TYPE` vào `prisma/migrations/<ts>_add_wallet_ledger/migration.sql`: `WalletTransactionType` với đúng 6 giá trị `'TOPUP', 'PURCHASE', 'EARNING', 'COMMISSION', 'ADMIN_GRANT', 'ISSUED_CREDIT'`; `WalletDirection` với `'CREDIT', 'DEBIT'`; `SystemAccountType` với **đúng một** giá trị `'PLATFORM_REVENUE'` (data-model.md mục 2 — một giá trị là cố ý theo Nguyên tắc VI)
- [X] T005 Thêm `CREATE TABLE "SystemAccount"` vào cùng `migration.sql`: khoá chính là chính cột `type` (không có `id` riêng), `balance BIGINT NOT NULL DEFAULT 0`, `"updatedAt" TIMESTAMPTZ` nullable, và `CONSTRAINT "SystemAccount_balance_check" CHECK (balance >= 0)` khai ngay tại `CREATE TABLE`
- [X] T006 Thêm `INSERT INTO "SystemAccount" (type, balance) VALUES ('PLATFORM_REVENUE', 0);` vào cùng `migration.sql`
- [X] T007 Thêm `CREATE TABLE "WalletTransaction"` vào cùng `migration.sql` với đủ 13 cột theo data-model.md mục 3 — lưu ý `"userId"` **nullable**, `"balanceAfter" BIGINT NOT NULL` **chưa có** ràng buộc không-âm (thêm ở T042)
- [X] T008 Thêm 5 ràng buộc `CHECK` vào `CREATE TABLE "WalletTransaction"` trong `prisma/migrations/<ts>_add_wallet_ledger/migration.sql`, chép **nguyên văn** từ data-model.md mục 4: `amount_check` là `CHECK (amount > 0)`; `account_check` là `CHECK ((("userId" IS NOT NULL)::int + ("systemAccount" IS NOT NULL)::int) = 1)`; `accountKind_check` với đủ 5 nhánh `OR`; `source_check` với 3 nhánh; `actor_check` buộc `ADMIN_GRANT` và `ISSUED_CREDIT` có `"createdById" IS NOT NULL AND note IS NOT NULL AND length(trim(note)) > 0`; `transfer_check` buộc `transferId` chỉ và luôn có với `ADMIN_GRANT`
- [X] T009 Thêm 5 `CREATE INDEX` vào cùng `migration.sql` theo data-model.md mục 4: `order_type_key` unique trên `("orderId", type)`, `topUp_key` unique trên `("topUpTransactionId")`, `transfer_leg_key` unique trên `("transferId", direction)`, và hai index đọc trên `("userId", "createdAt" DESC)` và `("systemAccount", "createdAt" DESC)` — tất cả đều `WHERE <cột> IS NOT NULL`
- [X] T010 Cập nhật `prisma/schema.prisma` khớp với DDL vừa viết (2 model, 3 enum), rồi chạy `npm run prisma:generate`. Không dùng `migrate dev` để sinh lại schema — DDL là nguồn đúng, schema đi theo

### Entity và hằng số

- [X] T011 [P] Tạo `src/entities/wallet-transaction.model.ts` — Zod schema cho bản ghi sổ cái, số tiền kiểu `bigint`, serialize ra **chuỗi thập phân** như `totalAmount` đang làm
- [X] T012 [P] Tạo `src/entities/system-account.model.ts` — Zod schema cho tài khoản hệ thống
- [X] T013 [P] Tạo `src/shared/constants/wallet.constant.ts` — hằng số cho 6 loại bút toán, 2 chiều, 1 loại tài khoản hệ thống, và **bảng 7 tổ hợp hợp lệ** ở data-model.md mục 3.1 để tầng ứng dụng không phải nhớ

### Lõi ghi sổ

- [X] T014 Tạo `src/routes/wallet/wallet.repo.ts` với hàm ghi một bút toán (nhận loại, chiều, số tiền, số dư sau, tài khoản, nguồn gốc, `transferId`, `note`, `createdById`) và hàm đổi số dư `SystemAccount` bằng `updateManyAndReturn` — trả về số dư sau khi cập nhật, **không** đọc lại bằng `SELECT` riêng (research.md R1)
- [X] T015 Tạo `src/routes/wallet/wallet.service.ts` với các hàm ghi sổ cho module khác gọi. Mọi hàm nhận `tx` của transaction đang mở, **không tự mở transaction** — FR-006 buộc ghi sổ và đổi số dư cùng thành công hoặc cùng không
- [X] T016 Tạo `src/routes/wallet/wallet-core.module.ts` — **KHÔNG có controller**. Lý do bắt buộc: `TopUpCoreModule` sẽ import module này, mà `TopUpCoreModule` đang được `CronModule` import; để lọt controller vào đây là route lịch sử ví lộ ra trên cổng cron server (research.md R14)

**Checkpoint**: migration chạy được trên database rỗng, lõi ghi sổ tồn tại nhưng chưa ai gọi

---

## Phase 3: User Story 1 — Giải thích được số dư của mình (P1) 🎯 MVP

**Goal**: mọi biến động ví người dùng để lại bút toán, và người dùng xem được lịch sử của chính mình

**Independent Test**: nạp tiền rồi mua một món, mở `GET /wallet-transactions`, thấy hai dòng mới và cộng dồn ra đúng số dư thật

### Đường ghi — nạp tiền

- [X] T017 [US1] Sửa `src/routes/topup/topup.repo.ts`: hàm cộng số dư đổi từ `updateMany` sang `updateManyAndReturn` để trả về số dư sau khi cộng
- [X] T018 [US1] Sửa `src/routes/topup/topup.service.ts` hàm `creditTopUp`: sau khi cộng số dư, ghi một bút toán `TOPUP` chiều `CREDIT` gắn `topUpTransactionId`, trong cùng transaction. Số tiền bằng 0 thì **không ghi dòng nào** (FR-007)
- [X] T019 [US1] Sửa `src/routes/topup/topup-core.module.ts` import `WalletCoreModule`

### Đường ghi — mua hàng

- [X] T020 [US1] Sửa `src/routes/order/order.repo.ts`: `debitBalance` (dòng 139) và `creditPublisherBalance` (dòng 155) đổi sang `updateManyAndReturn`. **Giữ nguyên** điều kiện `balance: { gte: amount }` ở `debitBalance` — đó là chốt chặn âm có sẵn
- [X] T021 [US1] Sửa `src/routes/order/order.service.ts`: sau `createOrder`, ghi bút toán `PURCHASE` chiều `DEBIT` cho khách (số tiền `totalAmount`) và `EARNING` chiều `CREDIT` cho nhà phát hành (số tiền `publisherAmount`), cả hai gắn `orderId`. Ghi **sau** khi tạo đơn vì cần `orderId` (research.md R3). `publisherAmount` bằng 0 thì bỏ dòng `EARNING`
- [X] T022 [US1] Sửa `src/routes/order/order.module.ts` import `WalletCoreModule`

### Đường đọc

- [X] T023 [US1] Thêm vào `src/routes/wallet/wallet.repo.ts` hàm đọc lịch sử theo `userId`, sắp xếp `"createdAt" DESC`, phân trang — dùng index `WalletTransaction_userId_createdAt_idx`
- [X] T024 [US1] Thêm vào `src/routes/wallet/wallet.service.ts` hàm đọc lịch sử của **người đang đăng nhập**. Hàm nhận `userId` từ token, **không** nhận từ tham số client (FR-025)
- [X] T025 [P] [US1] Tạo `src/routes/wallet/wallet.dto.ts` — DTO phân trang dùng `createZodDto`; payload trả về theo contracts mục 1, **không có** `systemAccount` và `transferId`
- [X] T026 [US1] Tạo `src/routes/wallet/wallet.controller.ts` — `GET /wallet-transactions` với `@SkipPermissionCheck()`, nằm sau `AccessTokenGuard`. Không có tham số nào nhận id người dùng (research.md R13)
- [X] T027 [US1] Tạo `src/routes/wallet/wallet.module.ts` (CÓ controller) và import nó vào `src/app.module.ts`

**Checkpoint**: nạp tiền và mua hàng đều để lại bút toán; người dùng xem được lịch sử của chính mình và không xem được của ai khác

---

## Phase 4: User Story 2 — Tiền của sàn có chỗ đứng (P2)

**Goal**: hoa hồng mỗi đơn vào tài khoản của sàn như một biến động có nguồn gốc

**Independent Test**: mua một sản phẩm có tỉ lệ hoa hồng khác 0, kiểm `SystemAccount.balance` tăng đúng phần hoa hồng và ba bút toán của đơn triệt tiêu nhau

**⚠️ Phụ thuộc US1**: task T029 sửa **cùng hàm** mà T021 đã sửa trong `order.service.ts`. Làm tuần tự, không song song.

- [X] T028 [US2] Thêm vào `src/routes/wallet/wallet.repo.ts` hàm cộng số dư `SystemAccount` theo `type`, dùng `updateManyAndReturn`
- [X] T029 [US2] Sửa `src/routes/order/order.service.ts`: thêm bước cộng tài khoản `PLATFORM_REVENUE` bằng `commissionAmount`, đặt **sau** bước cộng ví nhà phát hành và **trước** `createOrder`. Thứ tự bắt buộc theo plan.md — đơn thất bại vì khách thiếu tiền không được chạm vào tài khoản của sàn trước
- [X] T030 [US2] Sửa `src/routes/order/order.service.ts`: ghi thêm bút toán `COMMISSION` chiều `CREDIT` vào `systemAccount = 'PLATFORM_REVENUE'`, gắn `orderId`, cùng chỗ với hai bút toán ở T021. `commissionAmount` bằng 0 thì **không ghi dòng nào**
- [X] T031 [US2] Kiểm bằng tay trên `dist`: một đơn sinh **đúng ba** dòng và `PURCHASE = EARNING + COMMISSION`; một đơn tỉ lệ hoa hồng 0 sinh **hai** dòng. `splitAmount` ở `src/routes/order/order-split.ts:16` đảm bảo đẳng thức này với mọi đầu vào

**Checkpoint**: mỗi đơn hàng cân bằng — tiền không sinh ra, không mất đi

---

## Phase 5: User Story 3 — Phát hiện được số dư lệch (P3)

**Goal**: người vận hành có công cụ đối chiếu

**Independent Test**: đổi `Profile.balance` của một ví bằng SQL trực tiếp, chạy truy vấn (a), đúng ví đó hiện ra

**Không có mã nguồn nào** — đối soát là truy vấn trong runbook, không dựng API (research.md R10).

- [X] T032 [P] [US3] Thêm truy vấn (a) và (b) vào `docs/deployment-runbook.md`, chép nguyên văn từ data-model.md mục 7. Ghi kèm lý do truy vấn (b) **không có bộ lọc `deletedAt`** — đó chính là lý do tiền của sàn nằm ở bảng riêng
- [X] T033 [P] [US3] Thêm truy vấn (c) vào `docs/deployment-runbook.md` — so ba bút toán với **chính ba cột trên `Order`**, không so ba bút toán với nhau
- [X] T034 [P] [US3] Thêm truy vấn (d) vào `docs/deployment-runbook.md` — mỗi `transferId` đúng hai chân và cân nhau
- [X] T035 [P] [US3] Thêm truy vấn (e) báo cáo dòng tiền vào `docs/deployment-runbook.md`, kèm đẳng thức `tien_mat_vao + tien_tu_phat_hanh = no_voi_nguoi_dung + so_du_vi_san` và ghi rõ nó **chỉ đúng khi chưa có đường rút tiền**

**Checkpoint**: bốn phép kiểm ra 0 dòng trên database sạch; báo cáo (e) đọc được

---

## Phase 6: User Story 4 — Lịch sử cũ dựng lại đúng (P4)

**Goal**: ví có từ trước khi có sổ cái vẫn có lịch sử đầy đủ, và mọi tài khoản khớp tuyệt đối

**Independent Test**: chạy migration trên bản sao dữ liệu production đã dọn, cộng dồn lịch sử mọi tài khoản, 100% khớp số dư thật

Các task dưới ghi tiếp vào **cùng** `migration.sql` ở Phase 2, theo đúng thứ tự.

- [X] T036 [US4] Thêm backfill `TOPUP` vào `migration.sql`: một dòng cho mỗi lần nạp đã ghi có, `createdAt` lấy `creditedAt`, `"balanceAfter"` chèn **giá trị tạm 0**, kèm `ON CONFLICT DO NOTHING` trên `WalletTransaction_topUp_key`
- [X] T037 [US4] Thêm backfill `PURCHASE` vào `prisma/migrations/<ts>_add_wallet_ledger/migration.sql`: một dòng cho mỗi đơn có `totalAmount > 0`, `createdAt` lấy `paidAt`, `"balanceAfter"` tạm 0, `ON CONFLICT DO NOTHING` trên `WalletTransaction_order_type_key`
- [X] T038 [US4] Thêm backfill `EARNING` vào `prisma/migrations/<ts>_add_wallet_ledger/migration.sql`: một dòng cho mỗi đơn có `publisherAmount > 0`. Trên dữ liệu production hiện tại bước này sinh **0 dòng** vì phase 2 đã ghi mọi đơn cũ về phía sàn — vẫn phải viết, vì database local và tương lai khác
- [X] T039 [US4] Thêm backfill `COMMISSION` vào `prisma/migrations/<ts>_add_wallet_ledger/migration.sql`: một dòng cho mỗi đơn có `commissionAmount > 0`, gắn `orderId`, rồi `UPDATE "SystemAccount" SET balance = <Σ commissionAmount> WHERE type = 'PLATFORM_REVENUE'`. Ghi **từng đơn một**, không phải một khoản gộp (FR-022)
- [X] T040 [US4] Thêm **CHỐT DỪNG 1** vào `migration.sql`: nếu có ví nào lịch sử cộng ra **nhiều hơn** số dư thật thì `RAISE EXCEPTION` kèm danh sách ví. Không còn cơ chế bù trừ chiều âm nào (FR-021)
- [X] T041 [US4] Thêm **CHỐT DỪNG 2** vào `prisma/migrations/<ts>_add_wallet_ledger/migration.sql`: nếu còn tài khoản nào lệch bất kỳ thì `RAISE EXCEPTION` kèm danh sách. Đây là khác biệt lớn nhất so với thiết kế cũ — mọi tài khoản phải khớp tuyệt đối
- [X] T042 [US4] Thêm bước điền `"balanceAfter"` bằng tổng luỹ kế vào `prisma/migrations/<ts>_add_wallet_ledger/migration.sql`, chép nguyên văn window function ở data-model.md mục 6.2 bước 7 — phân hoạch theo `COALESCE("userId"::text, "systemAccount"::text)`, thứ tự `"createdAt"` → độ ưu tiên loại → `id`. Thứ tự phụ là thứ làm kết quả lặp lại được (SC-007)
- [X] T043 [US4] Thêm hai `ALTER TABLE ... ADD CONSTRAINT` ở **cuối** `migration.sql`: `WalletTransaction_balanceAfter_check CHECK ("balanceAfter" >= 0)` và `Profile_balance_check CHECK (balance >= 0)`. Đặt cuối vì T036–T039 chèn giá trị tạm 0
- [X] T044 [US4] Chạy `npm run prisma:migrate:deploy` trên database local, rồi **chạy lại lần hai** — không dòng nào được nhân đôi (FR-023)
- [X] T045 [US4] Viết quy trình dọn dữ liệu vào `docs/deployment-runbook.md`: thứ tự `Entitlement` → `Order` → `balance = 0`, chạy **trước** `migrate deploy`, kèm yêu cầu ghi lại số bản ghi đã xoá và tổng số dư đã đưa về 0 sau khi chạy. **Không** tạo file mã nguồn nào — lệnh thực thi không vào git (chốt với chủ repo 2026-11-25)

**Checkpoint**: migration chạy trọn vẹn và chạy lại được; bốn phép đối soát ra 0 dòng

---

## Phase 7: User Story 5 — Quản trị viên bù tiền cho người dùng (P5)

**Goal**: quản trị viên cộng tiền cho người dùng, rút từ tài khoản của sàn, hai chân nối nhau

**Independent Test**: cộng tiền cho một tài khoản, kiểm hai bút toán cùng `transferId` ngược chiều và cân nhau; thử cộng quá số dư ví sàn, nhận **422**

**⚠️ Phụ thuộc**: đường thành công cần tài khoản của sàn có tiền — tới từ US2 (hoa hồng) hoặc US6 (bơm tiền). Nếu làm US5 trước US6 thì phải có ít nhất một đơn hàng có hoa hồng để kiểm.

- [X] T046 [US5] Thêm vào `src/routes/wallet/wallet.repo.ts` hàm trừ số dư `SystemAccount` bằng **conditional update** với điều kiện `balance >= :amount` ngay trong câu lệnh, trả về số dòng bị ảnh hưởng. Chốt chặn nằm ở đây, **không** ở `CHECK` của database (research.md R12)
- [X] T047 [P] [US5] Tạo `src/routes/wallet/wallet.error.ts` — lỗi "ví sàn không đủ tiền khả dụng" ánh xạ sang **422**, thông báo nói rõ số dư hiện có. Đây là tình huống **bình thường** ở giai đoạn đầu, không phải lỗi hệ thống (FR-035)
- [X] T048 [US5] Thêm vào `src/routes/wallet/wallet.service.ts` luồng cộng tiền: validate → sinh `transferId` → trừ tài khoản của sàn (0 dòng thì ném lỗi ở T047) → cộng ví người nhận → ghi **hai** bút toán `ADMIN_GRANT` cùng `transferId`, một `DEBIT` ở `systemAccount` và một `CREDIT` ở `userId`. Toàn bộ trong một transaction (FR-040)
- [X] T049 [US5] Thêm kiểm người nhận vào cùng luồng ở `src/routes/wallet/wallet.service.ts`: không tồn tại hoặc đã bị xoá → **404**, không tạo bút toán mồ côi (FR-039)
- [X] T050 [P] [US5] Thêm DTO vào `src/routes/wallet/wallet.dto.ts` theo contracts mục 2: `userId`, `amount` dạng chuỗi thập phân phải `> 0`, `note` **bắt buộc và không rỗng sau khi trim**. Payload trả về có cả `userBalanceAfter` và `systemBalanceAfter`
- [X] T051 [US5] Tạo `src/routes/wallet/admin-wallet.controller.ts` với `POST /admin/wallet-transactions/grant`, permission riêng, không dùng chung với route ở US6
- [X] T052 [US5] Thêm permission mới vào `src/seed/create-permissions.ts` **trong cùng PR** (Nguyên tắc II), và xoá cache role-permission sau khi seed
- [X] T053 [US5] Kiểm trên `dist` theo quickstart mục 4, **đường thất bại trước**: ví sàn không đủ → 422 (không phải 500); `amount` ≤ 0 → 422; thiếu `note` → 422; `note` toàn khoảng trắng → 422; người nhận đã xoá → 404; người dùng thường → 403

**Checkpoint**: cộng tiền hoạt động, và quan trọng hơn — mọi đường thất bại trả đúng mã

---

## Phase 8: User Story 6 — Quản trị viên bơm tiền vào tài khoản của sàn (P6)

**Goal**: cửa duy nhất tiền không có tiền mặt đối ứng đi vào hệ thống, có tên và có người chịu trách nhiệm

**Independent Test**: bơm một khoản, kiểm `SystemAccount.balance` tăng đúng và truy vấn (e) hiện nó ở dòng `tien_tu_phat_hanh`, không lẫn vào hoa hồng hay tiền mặt

- [X] T054 [US6] Thêm vào `src/routes/wallet/wallet.service.ts` luồng bơm tiền: validate → cộng `SystemAccount` → ghi **một** bút toán `ISSUED_CREDIT` chiều `CREDIT` với `note` và `createdById` bắt buộc, `transferId` để `NULL`
- [X] T055 [P] [US6] Thêm DTO vào `src/routes/wallet/wallet.dto.ts` theo contracts mục 3: `amount` chuỗi thập phân `> 0`, `note` bắt buộc không rỗng
- [X] T056 [US6] Thêm `POST /admin/system-account/issue-credit` vào `src/routes/wallet/admin-wallet.controller.ts` với **permission riêng** — không dùng chung với route cộng tiền, vì hai việc có tính chất vận hành khác hẳn nhau
- [X] T057 [US6] Thêm permission thứ hai vào `src/seed/create-permissions.ts` trong cùng PR, xoá cache sau khi seed
- [X] T058 [US6] Kiểm trên `dist` theo quickstart mục 5: `amount` ≤ 0 → 422; thiếu `note` → 422; người dùng thường → 403; đường thành công sinh đúng một bút toán và truy vấn (e) tách bạch `tien_tu_phat_hanh`

**Checkpoint**: toàn bộ 6 user story xong; chạy lại truy vấn (e) và kiểm đẳng thức dòng tiền

---

## Phase 9: Polish & Cross-Cutting

- [X] T059 [P] Viết unit test cho `splitAmount` kết hợp ba bút toán và cho quy tắc phá thế hoà của tổng luỹ kế, đặt ở `src/routes/wallet/test/` theo quy ước các module khác. **KHÔNG commit** (thư mục này nằm ngoài git) — theo quyết định của chủ repo ở PR #50 (research.md R15)
- [X] T060 [P] Kiểm 7 câu SQL vi phạm ràng buộc ở quickstart mục 7 — tất cả phải bị từ chối ở tầng dữ liệu
- [X] T061 [P] Kiểm phát hiện sửa số dư ngoài ứng dụng theo quickstart mục 8, ở **cả hai** loại tài khoản
- [X] T062 Kiểm cách ly dữ liệu trên `GET /wallet-transactions`: đăng nhập bằng tài khoản khác, thử mọi tham số query nghĩ ra được để lấy ví người khác — không tham số nào làm được (SC-006)
- [X] T063 Chạy toàn bộ danh sách kiểm cuối ở [quickstart.md](./quickstart.md) trên bản `dist`, không phải `start:dev`
- [X] T064 `npm run lint` và `npm test` phải pass
- [X] T065 `npm run build` phải pass, và `src/generated/prisma` phải mới — schema cũ làm build gãy với TS2694
- [X] T066 `docker build -t a2matex-be:wallet-check .` phải pass. **Không bỏ qua được**: build local xanh không chứng minh gì về image (plan.md mục Rủi ro)
- [X] T067 Rà lại `docs/deployment-runbook.md` — đủ 5 truy vấn đối soát và quy trình dọn dữ liệu, kèm ghi chú đây là ngoại lệ cố ý với Nguyên tắc III

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: không phụ thuộc gì
- **Phase 2 Foundational**: cần Phase 1 — **chặn mọi user story**
- **Phase 3–8**: cần Phase 2 xong
- **Phase 9 Polish**: cần mọi story muốn ship đã xong

### User Story Dependencies — đọc kỹ, không phải story nào cũng độc lập

| Story | Phụ thuộc | Lý do |
|---|---|---|
| **US1** (P1) | chỉ Phase 2 | độc lập |
| **US2** (P2) | **US1** | T029/T030 sửa cùng hàm trong `order.service.ts` mà T021 đã sửa — làm tuần tự |
| **US3** (P3) | chỉ Phase 2 | chỉ là tài liệu, không đụng mã nguồn |
| **US4** (P4) | chỉ Phase 2 | ghi tiếp vào cùng `migration.sql`; nhưng backfill `COMMISSION` (T039) chỉ có nghĩa khi đã hiểu US2 |
| **US5** (P5) | **US2 hoặc US6** | đường thành công cần tài khoản của sàn có tiền |
| **US6** (P6) | chỉ Phase 2 | độc lập — và là cách dễ nhất để nạp tiền kiểm US5 |

**Gợi ý thứ tự thực tế**: US1 → US2 → US6 → US5 → US3 → US4. Đảo US6 lên trước US5 để có tiền kiểm đường thành công; US3 và US4 để cuối vì không chặn ai.

### Within Each Story

- Repo trước service, service trước controller
- DTO song song được với repo/service (khác file)
- Permission seed đi **cùng PR** với controller, không tách sau (Nguyên tắc II)
- Trong US5: **kiểm đường thất bại trước đường thành công** — 422 với ví sàn không đủ tiền là chỗ dễ làm sai nhất

### Parallel Opportunities

- **Phase 2**: T011, T012, T013 song song (ba file khác nhau)
- **Phase 5 (US3)**: T032–T035 song song — bốn mục khác nhau trong runbook
- **Phase 9**: T059, T060, T061 song song
- **Không song song được**: mọi task ghi vào `migration.sql` (T004–T009, T036–T043) — cùng một file, và thứ tự câu lệnh là một phần của thiết kế

---

## Parallel Example: Phase 2

```bash
# Ba file entity/hằng số độc lập nhau:
Task: "Tạo src/entities/wallet-transaction.model.ts"
Task: "Tạo src/entities/system-account.model.ts"
Task: "Tạo src/shared/constants/wallet.constant.ts"
```

## Parallel Example: User Story 3

```bash
# Bốn mục runbook, không đụng nhau:
Task: "Thêm truy vấn (a) và (b) vào docs/deployment-runbook.md"
Task: "Thêm truy vấn (c) vào docs/deployment-runbook.md"
Task: "Thêm truy vấn (d) vào docs/deployment-runbook.md"
Task: "Thêm truy vấn (e) vào docs/deployment-runbook.md"
```

---

## Implementation Strategy

### MVP — chỉ US1

1. Phase 1 Setup
2. Phase 2 Foundational (**chặn mọi thứ**)
3. Phase 3 US1
4. **DỪNG VÀ KIỂM**: nạp tiền + mua hàng để lại bút toán, lịch sử cộng dồn ra đúng số dư
5. Ship được — nhưng hoa hồng vẫn chưa có chỗ đứng, nên chưa giải quyết được vấn đề gốc

### Giao từng phần

1. Setup + Foundational → nền sẵn sàng
2. + US1 → lịch sử ví chạy (MVP)
3. + US2 → **mỗi đơn hàng cân bằng**; đây mới là chỗ vấn đề gốc được giải quyết
4. + US6 → có tiền trong tài khoản của sàn để làm việc
5. + US5 → quản trị viên bù tiền được, có nguồn và chứng minh được
6. + US3 → công cụ đối soát cho người vận hành
7. + US4 → dựng lại lịch sử cũ, **bước cuối trước khi deploy production**

### Thứ tự khi deploy production

Khác với thứ tự phát triển, và không đảo được:

```text
1. Dọn dữ liệu (runbook, T045) — chạy tay, review riêng
2. Chạy đối soát (a) — phải ra 0 dòng TRƯỚC khi sang bước 3
3. prisma migrate deploy
4. Thay container app
5. seed:permissions + xoá cache
6. Chạy lại cả 5 truy vấn đối soát
```

Bước 2 không bỏ qua được: nếu còn ví lệch, migration sẽ dừng ở chốt dừng khi bảng đã tạo một phần.

---

## Notes

- `[P]` = khác file, không phụ thuộc task chưa xong
- Số tiền đi qua `BigInt`, serialize ra **chuỗi thập phân** — không bao giờ qua `number` của JavaScript
- Mọi kiểm thủ công chạy trên `dist` (`npm run start:prod`), **không** `start:dev`: `tsx` không emit decorator metadata nên DTO không được validate
- Commit sau mỗi task hoặc nhóm hợp lý; dừng ở checkpoint để kiểm từng story
- **Không sửa migration để nó đi qua chốt dừng** — chốt dừng kêu nghĩa là dữ liệu chưa sẵn sàng


---

## Ghi chú thực thi (2026-11-25)

Toàn bộ 67 task đã chạy. Ba chỗ khác với mô tả task, ghi lại để review không phải đoán:

1. **T015 nói "mọi hàm nhận `tx`"** — sai với repo này. Quy ước ở đây là `@Transactional()`
   + `PrismaService.getClient()` tự nhận transaction đang mở qua AsyncLocalStorage. Đã làm
   theo quy ước repo. Kèm một bẫy: `@Transactional()` **bắt buộc** class inject
   `TransactionService` dưới đúng tên `transactionService`, nếu không nó ném `Error` lúc
   chạy — đã làm 3 route trả 500 trước khi phát hiện.
2. **T029 nói cộng ví sàn TRƯỚC `createOrder`** — đã gộp vào cùng chỗ ghi bút toán
   `COMMISSION`, tức SAU `createOrder`. Bút toán cần `orderId`, và tài khoản của sàn là một
   dòng mà mọi đơn đều tranh nhau, nên giữ khoá của nó muộn hơn là tốt hơn. Thứ tự quan
   trọng — trừ ví khách trước — vẫn giữ nguyên.
3. **T052/T057 nói sửa `create-permissions.ts` bằng tay** — không cần. Seeder tự quét
   decorator của controller; chạy `npm run seed:permissions` phát hiện đủ 3 route mới.

**Bổ sung 2026-11-25, lượt kiểm thứ hai** — ba chỗ ban đầu chưa chạy nay đã chạy hết:

- **Nạp tiền qua webhook SePay**: tạo yêu cầu nạp → bắn `POST /topups/sepay/webhook` với
  mã tham chiếu → số dư 0 → 250.000 và sinh đúng một bút toán `TOPUP/CREDIT` kèm
  `topUpTransactionId`. Đây là luồng mà lượt kiểm đầu **bỏ sót** — backfill có dựng
  `TOPUP` nhưng đường ghi lúc chạy thì chưa ai chạm tới.
- **403 với người dùng thường**: cả hai route quản trị đều trả **403**. Dùng một tài khoản
  CUSTOMER có sẵn, sao chép hash mật khẩu của admin sang để đăng nhập được.
- **Mua gói miễn phí 0 đồng**: HTTP 200, `totalAmount = 0`, và **0 bút toán** cho đơn đó
  (FR-007).

Kèm hai thứ kiểm thêm: người dùng chỉ thấy lịch sử của chính mình, và mọi tham số truy vấn
cố nhét id người khác đều bị **422 từ chối thẳng** — schema `.strict()` loại khoá lạ, nên
không phải "lọc bỏ" mà là không nhận.

**Kiểm chạy trên database nháp** (`a2matex_wallet_test`, nhân bản từ `a2matex_dev`), không
phải trên `a2matex_dev`. DB dev còn nguyên: 28 profile, 22 đơn, chưa có bảng sổ cái. Lý do:
DB dev có 6 ví rác từ các lần verify trước và dọn nó là thao tác huỷ dữ liệu mà chủ repo
chưa duyệt cho môi trường local.
