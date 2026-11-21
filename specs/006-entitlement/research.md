# Research: 006-entitlement

**Input**: [spec.md](./spec.md), [planning-notes.md](./planning-notes.md), codebase hiện tại.
Mỗi mục: Decision / Rationale / Alternatives considered. Những chỗ khác với `planning-notes.md`
được đánh dấu **(thay đổi so với planning-notes)**.

## R1. Lưu lịch sử kiểm toán (FR-040) — **(thay đổi so với planning-notes)**

**Decision**: Thêm cột `Entitlement."auditHistory" JSONB NOT NULL DEFAULT '[]'`, append một entry
trong **cùng câu lệnh UPDATE/INSERT** thay đổi quyền (`COALESCE("auditHistory",'[]') ||
jsonb_build_array(...)`). Không tạo bảng `AuditLog` ở feature này.

**Rationale**:
- Repo đã có đúng pattern này cho moderation: `User.auditHistory` (`user.repo.ts`
  `transitionStatus`) và `PublisherAccount` (`publisher.repo.ts`). Dùng lại giữ codebase nhất quán
  (Constitution VI — không thêm abstraction mới khi pattern sẵn có đủ dùng).
- Append trong cùng câu lệnh → audit và thay đổi thành công/thất bại cùng nhau (FR-040) mà không
  cần cơ chế riêng.
- Mảng nằm trên chính row Entitlement, không bị xoá khi grant lại → lịch sử revoke vẫn tra được
  (SC-005). Code chỉ có đường append, không có đường sửa/xoá phần tử.
- Tần suất thấp (thao tác Admin thủ công), mảng tăng chậm.

**Alternatives considered**:
- Bảng `AuditLog` chung theo `db_design/05` §2: đúng hướng dài hạn khi cần truy vấn audit xuyên
  entity, nhưng hiện chưa có ở đâu trong repo; tạo riêng cho một feature là trừu tượng hoá sớm.
  Khi Audit Log Module (checklist) được làm, có thể migrate các mảng `auditHistory` sang.
- Bảng `EntitlementEvent` riêng: thêm một bảng chỉ để đọc lịch sử một entity, không lợi gì hơn
  mảng JSONB ở quy mô này.

## R2. Chia sẻ transaction với Order (FR-011) — **(thay đổi so với planning-notes)**

**Decision**: Contract cho Order **không nhận transaction client**. `EntitlementRepo` dùng
`PrismaService.getClient()`; khi Order gọi từ method `@Transactional()` của nó, repo tự tham gia
transaction đó qua `TransactionContext`.

**Rationale**: đúng cơ chế hiện có (`TransactionService.runInTransaction`, `PrismaService.getClient`);
`ProductOfferService.assertActivationReady` là tiền lệ — được `ProductService` gọi trong transaction
lifecycle mà không truyền client. Contract đơn giản hơn và không lộ Prisma ra ngoài module.

**Alternatives considered**: truyền `Prisma.TransactionClient` tường minh — trùng chức năng với
`TransactionContext`, lệch convention.

## R3. Trạng thái lưu và trạng thái hiển thị (FR-004)

**Decision**: enum `EntitlementStatus` chỉ có `ACTIVE`, `REVOKED`. Trạng thái hiển thị
(`ACTIVE` | `EXPIRED` | `REVOKED`) tính trong SQL bằng `now()` của DB:
`CASE WHEN status='REVOKED' THEN 'REVOKED' WHEN "expiresAt" IS NOT NULL AND "expiresAt" <= now()
THEN 'EXPIRED' ELSE 'ACTIVE' END`.

**Rationale**: Clarification 2026-11-21 (không có tác vụ định kỳ) → giá trị `EXPIRED` không bao giờ
được ghi; giữ nó trong enum chỉ tạo trạng thái không dùng tới. Thêm giá trị enum sau này là
`ALTER TYPE … ADD VALUE`, rẻ. Tính trong SQL đáp ứng FR-012 (một nguồn thời gian).

**Alternatives considered**: giữ 3 giá trị theo `db_design/04` — thừa (YAGNI); tính trong
TypeScript bằng `new Date()` — vi phạm FR-012.

## R4. Thời gian transaction (FR-012)

**Decision**: các truy vấn khoá trả kèm `now()` dạng epoch ms (`transactionNow`), giống
`ProductOfferRepo.lockProduct`. Mọi timestamp ghi xuống (`startsAt`, `revokedAt`, entry audit) dùng
giá trị này hoặc `now()` trong SQL.

**Rationale**: `now()` cố định trong suốt một transaction PostgreSQL; pattern epoch ms tránh khác
biệt kiểu trả về của driver (đã ghi chú trong `product-offer.repo.ts`).

## R5. Khoá và đồng thời

**Decision**:
- **Grant**: `Product FOR UPDATE` (kiểm tra `deletedAt IS NULL`, `status='ACTIVE'`) → `Profile`
  của customer `FOR UPDATE` (join `User.deletedAt IS NULL`) → `Entitlement` theo
  `(customerId, productId) FOR UPDATE` → INSERT hoặc UPDATE.
- **Revoke**: đọc Entitlement theo id (không khoá) lấy `customerId` → `Profile FOR UPDATE` →
  `Entitlement FOR UPDATE` và kiểm tra lại `status`.
- Thứ tự này là tập con của thứ tự chung với Order/Product Offer:
  `Product → ProductOffer → Profile → Entitlement`.
- Unique `(customerId, productId)` là lớp chặn cuối; với khoá `Profile`, vi phạm unique không xảy
  ra trong luồng bình thường nên được coi là lỗi nội bộ (log + 500).
- Hết thời gian chờ khoá (`isTransactionTimeoutPrismaError`) → `503
  Error.EntitlementOperationTimeout`, giống `ProductOfferReplaceTimeoutException`.

**Rationale**: khoá `Profile` tuần tự hoá mọi thao tác quyền của cùng một customer, kể cả lần đầu
khi chưa có row Entitlement để khoá (edge case "grant và mua đồng thời"). Khoá `Product` khi grant
tránh race với Product lifecycle (Product bị suspend/archive giữa lúc kiểm tra và lúc ghi).

**Alternatives considered**: `INSERT … ON CONFLICT` không khoá trước — không đọc được giá trị
"trước" cho audit một cách nhất quán; khoá tư vấn (`pg_advisory_xact_lock`) — thêm cơ chế mới khi
row lock đã đủ.

## R6. Permission và phân quyền route (FR-050–052, Constitution II)

**Decision**:
- Bốn route mới được `seed:permissions` tự quét từ decorator controller và gán cho role `ADMIN`.
- `GET /entitlements/me`: permission **không scope**; gán cho role `CUSTOMER` qua Role API (bước vận
  hành, giống `POST /topups`, `GET /profiles/me`). Không dùng scope `OWN` vì route chỉ đọc theo
  `userId` của token — không có tham số nào trỏ tới dữ liệu người khác.
- Route `/admin/entitlements/*`: chỉ role `ADMIN` có permission (theo tiền lệ
  `AdminUserController`); không gán cho role khác.
- Chạy `seed:permissions` xong thì cache role-permission được script tự xoá.

**Rationale**: khớp cơ chế seed hiện tại (`create-permissions.ts` chỉ đồng bộ cho admin; quyền của
customer được gán qua Role API). Scope `OWN` chỉ cần khi cùng một route phục vụ cả owner và admin.

## R7. Hợp đồng nội bộ cho module khác (FR-010, FR-011)

**Decision** — `EntitlementService` (export từ `EntitlementModule`):

- `checkUsage({ customerId, productId })` → `{ usable: true, entitlementId } |
  { usable: false, reason }`, `reason ∈ NOT_FOUND | REVOKED | EXPIRED | PRODUCT_UNAVAILABLE |
  PRODUCT_SUSPENDED`. Một câu SQL join `Product`, dùng `now()`. Module gọi tự chọn mã lỗi HTTP.
- `lockForPurchase({ customerId, productId })` → snapshot đã khoá (`id`, `status`, `expiresAt`,
  `oneTimePurchasedAt`) hoặc `null`. Order gọi **sau khi** đã khoá Product, Offer và Profile; Order
  đã có `transactionNow` từ lần khoá Product của nó và truyền vào `activateFromOrder`.
- `activateFromOrder({ customerId, productId, orderItemId, productOfferId, offerType,
  durationDays, now })` → INSERT hoặc UPDATE theo FR-011; `oneTimePurchasedAt =
  COALESCE("oneTimePurchasedAt", now)` khi `ONE_TIME`; xoá revoke fields không cần (Order đã chặn
  REVOKED). Không append `auditHistory` (FR-041).

`lockForPurchase` và `activateFromOrder` được định nghĩa và unit test ở 006, dùng ở 007.

**Rationale**: trả kết quả có lý do thay vì ném lỗi cố định → Download/Lease/Launcher dùng chung
logic nhưng giữ mã lỗi riêng. Tách "khoá + đọc" khỏi "ghi" để Order tự áp quy tắc chặn mua (thuộc
spec 007).

## R8. `latestOrderItemId` khi chưa có bảng `OrderItem`

**Decision**: tạo cột `latestOrderItemId UUID NULL` **không có FK** ở migration 006; migration của
007 thêm `FOREIGN KEY … REFERENCES "OrderItem"(id)`. Trong 006 cột luôn null.

**Rationale**: giữ 006 triển khai và deploy độc lập (Constitution III: mỗi migration apply sạch);
không tạo bảng `OrderItem` rỗng trước khi có spec của nó.

**Alternatives considered**: gộp migration 006 + 007 — buộc hai feature deploy cùng lúc, mất lợi ích
tách spec.

## R9. Input của Admin grant/revoke

**Decision**:
- Grant: `customerId` (uuid), `productId` (uuid), `expiresAt` (ISO datetime **bắt buộc có mặt**,
  giá trị `null` = vĩnh viễn), `reason` (trim, 1..2000).
- Revoke: param `entitlementId` (uuid), body `reason` (trim, 1..2000).
- "Hạn ở tương lai" kiểm tra trong transaction so với `transactionNow` (không ở DTO) để dùng cùng
  nguồn thời gian.
- Response: grant/revoke trả Entitlement dạng admin sau thay đổi (để UI không cần gọi lại).

**Rationale**: bắt buộc `expiresAt` có mặt tránh việc quên trường vô tình tạo quyền vĩnh viễn; giới
hạn 2000 giống `PRODUCT_STATUS_REASON_MAX_LENGTH`.

## R10. Kiểm thử

**Decision**: Vitest unit test co-located trong `src/routes/entitlement/test/` (pattern
`project-draft/test`), mock repo cho service (quy tắc grant/revoke, trạng thái hiển thị, audit entry,
mapping lỗi) và controller. Hành vi constraint/khoá/đồng thời kiểm chứng trên DB thật theo
[quickstart.md](./quickstart.md).

**Rationale**: repo chưa có hạ tầng test DB tự động; giữ đúng quy ước hiện tại thay vì thêm
testcontainers (Constitution VI).
