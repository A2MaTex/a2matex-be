# Planning Notes: 006-entitlement

**Purpose**: Các quyết định kỹ thuật đã thảo luận khi viết spec, tách khỏi `spec.md` để spec chỉ mô
tả nghiệp vụ. Dùng làm đầu vào cho `/speckit-plan` (research/data-model/contracts). Không phải quyết
định cuối — plan có thể điều chỉnh kèm lý do.

> **Đã bị thay thế một phần bởi [research.md](./research.md)** — khi mâu thuẫn, research/plan là
> nguồn đúng:
> - Bảng `AuditLog` → mảng `Entitlement."auditHistory"` JSONB (R1).
> - Contract nhận Prisma transaction client → tham gia transaction qua `TransactionContext` (R2).
> - `404 Error.UserNotFound` → `404 Error.EntitlementCustomerNotFound`; thêm
>   `503 Error.EntitlementOperationTimeout` (contracts/entitlement-api.md).
> - Route customer không dùng scope `OWN` (R6).

**Source**: `a2matex-docs/components/a2matex-backend/db_design/04_commerce_entitlement_execution.md`
§4, `db_design/05_operations_support.md` §2, và các quyết định trong Clarifications của spec.

## Data model

Bảng `Entitlement` theo `db_design/04` §4, với các điều chỉnh:

- `UNIQUE("customerId", "productId")` (FR-001).
- Trạng thái lưu trong MVP chỉ `ACTIVE` | `REVOKED`; `EXPIRED` suy ra lúc đọc (FR-004). Plan quyết
  định có giữ giá trị `EXPIRED` trong enum hay không (YAGNI — Constitution VI).
- Constraint revoke **hai chiều** (FR-005), thay cho constraint một chiều trong design:
  ```sql
  CHECK (
    (status = 'REVOKED')
    = ("revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL AND "revokedReason" IS NOT NULL)
  )
  -- và khi không REVOKED thì cả ba phải NULL
  ```
- `CHECK ("expiresAt" IS NULL OR "expiresAt" > "startsAt")`.
- `grantSnapshot` JSONB, `CHECK (jsonb_typeof = 'object')`, giá trị MVP cố định (FR-006):
  `{"schemaVersion":"1.0","releaseAccess":"CURRENT_AND_SUPPORTED","allowUpdates":true}`.
- `latestOrderItemId` FK → `OrderItem`: bảng `OrderItem` thuộc spec 007. Hoặc tạo cột không FK ở 006
  và thêm FK ở migration của 007, hoặc triển khai migration hai spec cùng lúc.

Bảng `AuditLog` tối thiểu theo `db_design/05` §2 (`actorType`, `actorUserId`, `action`,
`resourceType`, `resourceId`, `correlationId`, `beforeData`, `afterData`, `metadata`, `occurredAt`).
Action: `ENTITLEMENT_GRANT`, `ENTITLEMENT_REVOKE`; `reason` nằm trong `afterData`.

Migration chỉ lấy bảng/enum cần cho slice này (Constitution III, README `db_design`).

## Concurrency

- Thứ tự khoá dùng chung với Order và Product Offer:
  `Product → ProductOffer → Profile (customer) → Entitlement`.
- Admin grant khoá `Product` trước và kiểm tra `status = ACTIVE`, `deletedAt IS NULL` (Clarification
  2026-11-21: chỉ Product đang bán), tránh race với Product lifecycle; revoke không cần khoá Product.
- Admin grant/revoke dùng tập con theo đúng thứ tự: khoá `Profile` của customer rồi `Entitlement`
  (`SELECT … FOR UPDATE`). Khoá `Profile` tuần tự hoá với Order lần đầu khi chưa có row Entitlement
  để khoá; unique constraint là lớp chặn cuối (bắt P2002 → đọc lại và xử lý).
- `now` lấy từ `now()` của database transaction (FR-012).
- Bắt lỗi serialization/deadlock và retry có giới hạn như `product-offer.repo.ts`.

## Internal contracts

- `EntitlementModule` export repo/service; KHÔNG import `OrderModule` (tránh vòng phụ thuộc).
- Kiểm tra quyền dùng chung (FR-010), ví dụ:
  `assertUsable(customerId, productId) → Entitlement` hoặc ném lỗi; điều kiện:
  `status != REVOKED && (expiresAt IS NULL || expiresAt > now) && product.deletedAt IS NULL &&
  product.status != SUSPENDED`.
- Contract cho Order (FR-011), nhận Prisma transaction client:
  - `findForUpdate(tx, customerId, productId) → Entitlement | null`
  - `grantFromOrder(tx, { customerId, productId, orderItemId, productOfferId, offerType,
    durationDays, now })` — upsert: `status = ACTIVE`, `grantSource = ORDER`, `grantedById = null`,
    `startsAt = now`, `expiresAt = now + durationDays | null`, `latest*Id`, `grantSnapshot`,
    `oneTimePurchasedAt = COALESCE(oneTimePurchasedAt, now)` nếu `ONE_TIME`.

## API (gợi ý)

| Method | Path                             | Actor    | Scope |
| ------ | -------------------------------- | -------- | ----- |
| GET    | `/entitlements/me`               | CUSTOMER | OWN   |
| GET    | `/admin/entitlements`            | ADMIN    | —     |
| POST   | `/admin/entitlements/grant`      | ADMIN    | —     |
| POST   | `/admin/entitlements/:id/revoke` | ADMIN    | —     |

- Theo tiền lệ `@Controller('admin/users')`.
- Permission record + seed trong cùng PR, invalidate cache role-permission (Constitution II).
- BIGINT (nếu có) serialize thành decimal string; DTO dùng `nestjs-zod` (Constitution I).

## Error contract

| Điều kiện                              | Kết quả                                 |
| -------------------------------------- | --------------------------------------- |
| Body/param sai định dạng, thiếu reason | `422` validation error                  |
| `expiresAt` không ở tương lai          | `422 Error.EntitlementInvalidExpiresAt` |
| Customer không tồn tại / đã xoá        | `404 Error.UserNotFound`                |
| Product không tồn tại / đã xoá         | `404 Error.ProductNotFound`             |
| Product không `ACTIVE` (grant)         | `409 Error.EntitlementProductNotActive` |
| Entitlement không tồn tại (revoke)     | `404 Error.EntitlementNotFound`         |
| Revoke Entitlement đã REVOKED          | `409 Error.EntitlementAlreadyRevoked`   |
| Kiểm tra quyền thất bại (FR-010)       | do module gọi quyết định mã lỗi         |
