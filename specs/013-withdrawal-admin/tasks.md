---

description: "Danh sách việc — Quản trị viên duyệt đơn rút tiền và xem sổ cái"
---

# Tasks: Quản trị viên duyệt đơn rút tiền và xem sổ cái

**Input**: Design documents từ `/specs/013-withdrawal-admin/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/withdrawal-admin-api.md](./contracts/withdrawal-admin-api.md)

**Tests**: **CÓ**. Tách hai nhóm — test **chỉ import schema** thì **commit**; test **import
service** thì chặn bằng `.gitignore` (research R11).

**Organization**: nhóm theo user story.

## Format: `[ID] [P?] [Story] Mô tả`

---

## Phase 1: Setup

- [X] T001 Xác nhận đang ở nhánh `feat/withdrawal-admin` và `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --config prisma7.config.ts` in `No difference detected` — spec này **không có migration**, nên câu này phải sạch từ đầu tới cuối
- [X] T002 Thêm vào `.gitignore` hai dòng `src/routes/withdrawal/test/admin-*.spec.ts` và `src/routes/wallet/test/admin-*.spec.ts` kèm comment `# Test import service: chay local, khong len CI (specs/013-withdrawal-admin/research.md R11)` — **chỉ chặn test import service**, test schema thuần vẫn vào git

---

## Phase 2: Foundational (chặn mọi user story)

- [X] T003 [P] Thêm `WITHDRAWAL_ADMIN_PAGE_SIZE_MAX = 100` và `LEDGER_PAGE_SIZE_MAX = 100` vào `src/shared/constants/withdrawal.constant.ts` và `src/shared/constants/wallet.constant.ts`
- [X] T004 [P] Thêm 6 exception vào `src/routes/withdrawal/withdrawal.error.ts`: `WithdrawalNotPending` (đã có, dùng lại), `WithdrawalNotApproved` (409), `WithdrawalCannotReject` (409), `WithdrawalRejectionReasonRequired` (422), `WithdrawalTransferRefRequired` (422) — và dùng lại `WithdrawalNotFound`, `WithdrawalProfileNotFound` đã có
- [X] T005 [P] Thêm 2 exception vào `src/routes/wallet/wallet.error.ts`: `WalletUserNotFound` (404), `LedgerDateRangeInvalid` (422)
- [X] T006 Thêm schema admin vào `src/routes/withdrawal/withdrawal.model.ts` theo data-model.md §6: `GetAdminWithdrawalsInput` (trần 100, `status` nhận nhiều giá trị), `AdminWithdrawalOutput` (có khối `publisher` gồm `userId`+`fullName`+`email`), `GetAdminWithdrawalsOutput`, `RejectWithdrawalInput` (`reason` **`.trim()` TRƯỚC khi kiểm rỗng**), `MarkPaidWithdrawalInput` (`bankTransferRef` cũng `.trim()` trước). Output dùng `zBigIntAsString()` thì type phải là `z.input`, **không phải** `z.infer`
- [X] T007 Thêm schema vào `src/routes/wallet/wallet.model.ts`: `GetAdminLedgerInput` (trần 100, `types` nhiều giá trị, `from`/`to` kèm `superRefine` kiểm `from <= to`), `AdminLedgerOutput`, `UserWalletOutput` (có `breakdown.in` / `.out` / `totalIn` / `totalOut`), `ReconciliationOutput`
- [X] T008 [P] Tạo DTO tương ứng T006 trong `src/routes/withdrawal/withdrawal.dto.ts`
- [X] T009 [P] Tạo DTO tương ứng T007 trong `src/routes/wallet/wallet.dto.ts`

**Checkpoint**: schema và lỗi sẵn sàng

---

## Phase 3: User Story 1 — Duyệt và chi một đơn (P1) 🎯 MVP

**Goal**: quản trị viên đưa đơn đi trọn đường chờ duyệt → đã duyệt → đã chi

**Independent Test**: tạo đơn bằng tài khoản publisher, rồi bằng admin: xem danh sách → duyệt →
đánh dấu đã chi. Kiểm **số dư publisher không đổi ở cả hai bước** và **không bút toán mới nào**.

### Tests for User Story 1 ⚠️

- [X] T010 [P] [US1] **(COMMIT ĐƯỢC)** Test schema trong `src/routes/withdrawal/test/admin-withdrawal-schema.spec.ts`: `reason` rỗng / chỉ khoảng trắng bị từ chối; `bankTransferRef` rỗng / chỉ khoảng trắng bị từ chối; `limit=101` bị từ chối; `limit=100` qua. **Chỉ import `withdrawal.model.ts`, KHÔNG import service** — đó là điều kiện để file này vào được git
- [X] T011 [US1] **(KHÔNG COMMIT)** Test `AdminWithdrawalService` với repo giả trong `src/routes/withdrawal/test/admin-withdrawal.service.spec.ts`: duyệt khi `UPDATE` khớp 0 dòng và đơn không tồn tại ⇒ `NotFound`; khớp 0 dòng nhưng đơn tồn tại ⇒ `NotPending`; duyệt thành công ⇒ **không gọi hàm nào của `WalletRepo`**; đánh dấu chi khi chưa duyệt ⇒ `NotApproved`

### Implementation for User Story 1

- [X] T012 [US1] Thêm `listForAdmin({statuses, skip, take})` vào `src/routes/withdrawal/withdrawal.repo.ts` theo data-model.md §5.1: `JOIN User` và `JOIN Profile` lấy `email` + `fullName`; `status` bỏ trống thì **không lọc** (FR-005); sắp `ORDER BY "createdAt" DESC, id ASC`
- [X] T013 [US1] Thêm `approveIfPending({withdrawalId, adminUserId})` vào `withdrawal.repo.ts` — **một câu `UPDATE`** `WHERE id=? AND status='PENDING'`, `SET status='APPROVED', "processedAt"=now(), "processedById"=?`, `RETURNING`. **Không tách `SELECT ... FOR UPDATE` rồi `UPDATE`** (research R2). `processedAt` dùng `now()` của database, không `new Date()`
- [X] T014 [US1] Thêm `markPaidIfApproved({withdrawalId, adminUserId, bankTransferRef})` vào `withdrawal.repo.ts` — cùng khuôn, `WHERE status='APPROVED'`, và **đặt `bankTransferRef` trong cùng câu lệnh** vì `WithdrawalRequest_transferRef_check` chỉ cho cột đó có giá trị khi `status='PAID'`
- [X] T015 [US1] Tạo `src/routes/withdrawal/admin-withdrawal.service.ts` với `listAll()`, `approve()`, `markPaid()`. Hai hàm sau **không mở transaction và không khoá `Profile`** — chúng không đụng số dư (research R4). Khi `UPDATE` khớp 0 dòng thì đọc lại đơn **chỉ để chọn lỗi** 404 hay 409, và lỗi 409 phải **nêu trạng thái hiện tại**
- [X] T016 [US1] Tạo `src/routes/withdrawal/admin-withdrawal.controller.ts` `@Controller('admin/withdrawals')` với `GET /`, `POST /:withdrawalId/approve`, `POST /:withdrawalId/mark-paid`. **KHÔNG dùng `@SkipPermissionCheck()`** — khuôn `AdminEntitlementController`, gác quyền thật (research R10)
- [X] T017 [US1] Đăng ký `AdminWithdrawalController` và `AdminWithdrawalService` trong `src/routes/withdrawal/withdrawal.module.ts`
- [X] T018 [US1] Thêm log có cấu trúc cho `approve` và `markPaid` trong `admin-withdrawal.service.ts`: ghi `withdrawalId`, `adminUserId`, `amount`, và với `markPaid` thêm `bankTransferRef`

**Checkpoint**: US1 chạy độc lập — admin đưa được đơn tới `PAID`

---

## Phase 4: User Story 2 — Nhìn thấy nguồn gốc tiền trước khi duyệt (P1)

**Goal**: admin mở ví publisher và thấy tiền từ đâu ra trước khi bấm duyệt

**Independent Test**: mở ví một publisher có cả tiền bán hàng lẫn tiền admin cộng, kiểm
`totalIn − totalOut` **bằng đúng** số dư hiện tại.

### Tests for User Story 2 ⚠️

- [X] T019 [P] [US2] **(COMMIT ĐƯỢC)** Test schema trong `src/routes/wallet/test/admin-ledger-schema.spec.ts`: `from` sau `to` bị từ chối; `limit` vượt trần bị từ chối; `types` nhận nhiều giá trị. **Chỉ import `wallet.model.ts`**
- [X] T020 [US2] **(KHÔNG COMMIT)** Test `AdminWalletService.getUserWallet` với repo giả trong `src/routes/wallet/test/admin-wallet.service.spec.ts`: xếp `WITHDRAWAL_REVERSAL` vào nhóm **vào**; `totalIn − totalOut` bằng `balance`; người chưa có biến động trả số dư 0 và mảng rỗng chứ không ném lỗi

### Implementation for User Story 2

- [X] T021 [US2] Thêm `findLedger({userId, types, from, to, skip, take})` vào `src/routes/wallet/wallet.repo.ts` theo data-model.md §5.2: ba bộ lọc AND, bỏ trống thì không lọc; mốc `to` so bằng **`<`** không phải `<=`; sắp `ORDER BY "createdAt" DESC, id ASC` (`createdAt` một mình không phải thứ tự toàn phần — ba bút toán của một đơn hàng mang cùng mốc)
- [X] T022 [US2] Thêm `findBalanceBreakdown(userId)` vào `wallet.repo.ts`: `GROUP BY type, direction`, trả tổng và số dòng mỗi loại
- [X] T023 [US2] Thêm `findUserForWallet(userId)` vào `wallet.repo.ts` trả `email` + `fullName` + `balance`; không tìm thấy ⇒ `null`
- [X] T024 [US2] Tạo `src/routes/wallet/admin-wallet.service.ts` với `listLedger()` và `getUserWallet()`. Xếp nhóm theo data-model.md §5.3 — **`WITHDRAWAL_REVERSAL` thuộc nhóm VÀO**; bỏ sót nó làm mọi ví từng có đơn bị từ chối hiện ra là lệch
- [X] T025 [US2] Thêm `GET /admin/wallet-transactions` và `GET /admin/users/:userId/wallet` vào `src/routes/wallet/admin-wallet.controller.ts` **sẵn có** (không tạo controller mới — research R9)
- [X] T026 [US2] Export `AdminWalletService` từ `src/routes/wallet/wallet-core.module.ts` và đăng ký trong `wallet.module.ts`. **Kiểm `wallet-core.module.ts` vẫn KHÔNG mang controller nào** — `CronModule` nhận nó qua `TopUpCoreModule`, controller lọt vào sẽ phục vụ route trên cổng cron

**Checkpoint**: US1 và US2 chạy độc lập

---

## Phase 5: User Story 3 — Từ chối đơn và hoàn tiền (P2)

**Goal**: admin từ chối kèm lý do, tiền quay về ví publisher

**Independent Test**: tạo đơn, từ chối, kiểm số dư trở về mức ban đầu và sổ cái có đủ **2** bút
toán ngược chiều gắn cùng một đơn, dòng hoàn **có người thực hiện và lý do**.

### Tests for User Story 3 ⚠️

- [X] T027 [US3] **(KHÔNG COMMIT)** Test `AdminWithdrawalService.reject` với repo giả trong `src/routes/withdrawal/test/admin-withdrawal.service.spec.ts`: `UPDATE` khớp 0 dòng + đơn `PAID` ⇒ `CannotReject`; khớp 1 dòng ⇒ hoàn tiền **đúng một lần** và `recordWithdrawalReversal` nhận **đủ** `createdById` + `note`; không có hồ sơ ⇒ `ProfileNotFound` và **không gọi `UPDATE`**

### Implementation for User Story 3

- [X] T028 [US3] Thêm `rejectIfPendingOrApproved({withdrawalId, adminUserId, reason})` vào `withdrawal.repo.ts` — một câu `UPDATE` `WHERE id=? AND status IN ('PENDING','APPROVED')`, đặt `rejectionReason` **trong cùng câu lệnh** (ràng buộc `WithdrawalRequest_rejection_check` chỉ cho cột đó có giá trị khi `status='REJECTED'`), `RETURNING` kèm `amount` và `publisherUserId`
- [X] T029 [US3] Viết `AdminWithdrawalService.reject()` trong `@Transactional()` theo data-model.md §4: **khoá `Profile` TRƯỚC** → nếu không có hồ sơ thì báo lỗi và **KHÔNG đổi trạng thái đơn** (FR-026) → `UPDATE` có điều kiện → `creditUserBalance()` → `recordWithdrawalReversal({createdById, note})`
- [X] T030 [US3] Inject `TransactionService` vào `AdminWithdrawalService` **đúng tên `transactionService`** — `@Transactional()` đọc `this.transactionService` và ném lỗi **lúc chạy** nếu thiếu, trong khi build vẫn xanh
- [X] T031 [US3] Thêm `POST /admin/withdrawals/:withdrawalId/reject` vào `admin-withdrawal.controller.ts`

**Checkpoint**: cả ba đường đổi trạng thái hoàn chỉnh

---

## Phase 6: User Story 4 — Bảng đối soát (P3)

**Goal**: admin mở một trang và biết sổ có cân không

**Independent Test**: đối chiếu từng con số với kết quả chạy tay sáu truy vấn ở runbook B9.3 —
phải khớp tuyệt đối.

### Tests for User Story 4 ⚠️

- [X] T032 [US4] **(KHÔNG COMMIT)** Test `AdminWalletService.getReconciliation` với repo giả: đẳng thức hai túi tính đúng; một phép kiểm có dòng vi phạm thì `ok=false` và `offenders` không rỗng

### Implementation for User Story 4

- [X] T033 [US4] Thêm `runReconciliation()` vào `src/routes/wallet/wallet.repo.ts` chạy **đúng sáu truy vấn** ở `docs/deployment-runbook.md` mục B9.3 — **lấy nguyên, không viết lại** (research R7, SC-009 đòi khớp tuyệt đối với chạy tay). Bốn phép (a)(b)(c)(d) trả **danh sách dòng vi phạm**, không chỉ đếm (FR-036)
- [X] T034 [US4] Hai túi tiền rút tính theo **trạng thái đơn**, không theo sổ cái: `đã chi thật` = tổng đơn `PAID`; `đang chờ chi` = tổng đơn `PENDING` + `APPROVED` (FR-033a). Dùng lại `findSystemAccountBalance()` trong `wallet.repo.ts` — hàm đó đang là code chết từ spec 011, nay sống lại
- [X] T035 [US4] Thêm `getReconciliation()` vào `admin-wallet.service.ts`, tính `leftSide`/`rightSide`/`balanced` theo đẳng thức hai túi
- [X] T036 [US4] Thêm `GET /admin/wallet-transactions/reconciliation` vào `admin-wallet.controller.ts`. **Khai TRƯỚC** route nào có tham số đường dẫn trong cùng controller, nếu không Nest có thể khớp nhầm `reconciliation` thành tham số

**Checkpoint**: cả bốn user story xong

---

## Phase 7: Polish & Cross-Cutting

- [X] T037 [P] Thêm mục **B11** vào `docs/deployment-runbook.md` cho lần deploy spec 013: ghi rõ **KHÔNG có migration**, và **BẮT BUỘC chạy `seed-permissions`** (ngược với spec 012) vì bảy route gác quyền thật — không seed thì admin cũng nhận 403. Ghi kèm kết quả tiền-kiểm ngày 2026-11-27: 6 grant non-admin bị xoá mềm đều là tên route cũ đã biến mất, không khoản nào đang mất bị cache che
- [X] T038 Chạy toàn bộ **48 ca** trong [quickstart.md](./quickstart.md) trên `dist` (`npm run build && node dist/main.js`), **sau khi đã chạy `npm run seed:permissions`** — không seed thì mọi route trả 403
- [X] T039 Xác nhận `prisma migrate diff` vẫn in `No difference detected` — spec này không được đụng lược đồ
- [X] T040 `npm run lint` + `npm test` + `npm run build` đều xanh
- [X] T041 `git status --short --untracked-files=all` — file test **import service** phải **vắng mặt**, file test **schema thuần** phải **có mặt**

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup** → **Phase 2 Foundational** (chặn tất cả) → **Phase 3-6** → **Phase 7**
- US1 và US2 đều P1 và **độc lập nhau** — làm song song được nếu đủ người
- US3 dùng lại `withdrawal.repo.ts` mà US1 đã động vào ⇒ làm **sau** US1
- US4 dùng lại `wallet.repo.ts` mà US2 đã động vào ⇒ làm **sau** US2

### Parallel Opportunities

- Phase 2: T003 ∥ T004 ∥ T005, rồi T006 → T008 và T007 → T009 (hai nhánh song song)
- Phase 3: T010 độc lập. T012-T014 cùng đụng `withdrawal.repo.ts` ⇒ **tuần tự**
- Phase 4: T019 độc lập. T021-T023 cùng đụng `wallet.repo.ts` ⇒ **tuần tự**
- **US1 ∥ US2** — hai nhánh file hoàn toàn khác nhau

---

## Implementation Strategy

### MVP

Phase 1 + 2 + 3 (US1). Tới đó admin đã đưa được đơn rút tiền tới `PAID` — đơn không còn kẹt.

Nhưng **US2 cũng là P1 và nên làm liền**: duyệt mà không biết nguồn gốc tiền là chi tiền thật cho
nghĩa vụ có thể chưa từng có tiền thật đi vào, đúng tình trạng production hôm nay (36.000đ tiền
mặt thật so với 15.994.000đ tiền tự phát hành).

### Giao từng phần

1. Setup + Foundational → nền sẵn sàng
2. + US1 → đơn đi được tới cuối đường
3. + US2 → admin thấy nguồn gốc tiền trước khi bấm → **đây mới là quy trình an toàn**
4. + US3 → từ chối và hoàn tiền
5. + US4 → đối soát thành màn hình
6. + Polish → runbook và kiểm cuối

---

## Notes

- **Không có migration nào.** T001 và T039 kiểm điều đó ở hai đầu.
- Ba chỗ dễ sai nhất, đều có task riêng: **T029** (khoá `Profile` trước, không có hồ sơ thì không
  đổi trạng thái), **T024** (`WITHDRAWAL_REVERSAL` thuộc nhóm VÀO), **T033** (lấy nguyên truy vấn
  runbook, không viết lại).
- **T026 là task "kiểm chứ không thêm"** — xác nhận `wallet-core.module.ts` vẫn không mang
  controller, vì đường `CronModule → TopUpCoreModule → WalletCoreModule` sẽ phơi route lên cổng cron.
- `.gitignore` ở T002 **chỉ chặn `admin-*.spec.ts`**, không chặn cả thư mục — test schema thuần
  phải vào được git để CI bảo vệ phần kiểm input.
