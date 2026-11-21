# Data Model: 007-order

Nguồn: spec FR-005, FR-006, FR-021, FR-033, FR-040; quyết định ở [research.md](./research.md)
R2, R3, R9, R11, R12, R14. Một migration mới:
`prisma/migrations/<timestamp>_add_order/migration.sql` (tạo bằng `npm run prisma:migrate:create`,
viết tay nội dung, rồi `npm run prisma:generate`).

## Enum

```sql
CREATE TYPE "OrderStatus" AS ENUM ('PAID');   -- R3: MVP không bao giờ ghi PENDING/CANCELLED/FAILED
```

`ProductOfferType`, `ProductStatus`, `EntitlementStatus`, `EntitlementGrantSource` đã có.

## Bảng `Order`

> Tên bảng là từ khoá SQL — luôn viết `"Order"` trong mọi câu SQL viết tay (R9).

| Cột              | Kiểu               | Null | Ghi chú                                                      |
| ---------------- | ------------------ | ---- | ------------------------------------------------------------ |
| `id`             | UUID PK            | no   | `gen_random_uuid()`                                          |
| `customerId`     | UUID FK → `User`   | no   | chủ đơn; không bao giờ đổi                                   |
| `status`         | `OrderStatus`      | no   | default `'PAID'` (R3)                                        |
| `totalAmount`    | BIGINT             | no   | tổng tiền đã trừ; bằng `OrderItem."unitPriceAmount"` ở MVP   |
| `paidAt`         | TIMESTAMPTZ(6)     | no   | `transactionNow` của lần mua (FR-009)                        |
| `idempotencyKey` | UUID               | no   | mã chống trùng do client sinh (R2)                           |
| `createdAt`      | TIMESTAMPTZ(6)     | no   | default `now()`                                              |

Không có `updatedAt`, `deletedAt`, `createdById`: đơn hàng bất biến, không xoá, và `customerId`
chính là người tạo. Hoàn tiền/huỷ đơn ngoài phạm vi (spec Assumptions) — khi làm sẽ thêm cột và giá
trị enum ở migration của spec đó.

### Constraint và index

```sql
CONSTRAINT "Order_customerId_idempotencyKey_key"
    UNIQUE ("customerId", "idempotencyKey")                      -- FR-021, chốt chặn cuối của R5

CONSTRAINT "Order_totalAmount_check" CHECK ("totalAmount" >= 0)  -- FR-007: giá 0 hợp lệ, âm thì không

CREATE INDEX "Order_customerId_createdAt_idx"
    ON "Order" ("customerId", "createdAt" DESC);                 -- FR-030: lịch sử của một customer
```

Unique `(customerId, idempotencyKey)` cũng phục vụ luôn truy vấn tra key (R5) nên không cần index
riêng cho nó.

## Bảng `OrderItem`

| Cột               | Kiểu                     | Null | Ghi chú                                                   |
| ----------------- | ------------------------ | ---- | --------------------------------------------------------- |
| `id`              | UUID PK                  | no   | `gen_random_uuid()`                                       |
| `orderId`         | UUID FK → `Order`        | no   |                                                           |
| `productId`       | UUID FK → `Product`      | no   | Product đã mua                                            |
| `productOfferId`  | UUID FK → `ProductOffer` | no   | gói đã mua; vẫn hợp lệ khi gói bị xoá mềm                 |
| `unitPriceAmount` | BIGINT                   | no   | giá tại thời điểm mua                                     |
| `offerSnapshot`   | JSONB                    | no   | bản sao bất biến điều khoản (R12)                         |
| `createdAt`       | TIMESTAMPTZ(6)           | no   | default `now()`                                           |

### Constraint

```sql
CONSTRAINT "OrderItem_orderId_productId_key" UNIQUE ("orderId", "productId")   -- db_design/04 §3

CONSTRAINT "OrderItem_unitPriceAmount_check" CHECK ("unitPriceAmount" >= 0)

CONSTRAINT "OrderItem_offerSnapshot_object_check"
    CHECK (jsonb_typeof("offerSnapshot") = 'object')                            -- FR-006

CREATE INDEX "OrderItem_orderId_idx"   ON "OrderItem" ("orderId");
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem" ("productId");
```

Mọi FK dùng `ON DELETE NO ACTION ON UPDATE NO ACTION`, đúng convention các bảng hiện có.

### `offerSnapshot` (R12)

```json
{
  "schemaVersion": "1.0",
  "offerType": "SUBSCRIPTION",
  "priceAmount": "50000",
  "durationDays": 30
}
```

- `offerType ∈ ONE_TIME | SUBSCRIPTION` — tên field của snapshot; cột gốc trong `ProductOffer` tên
  là `type`.
- `priceAmount` là decimal string (R11), `durationDays` là số nguyên dương hoặc `null` (vĩnh viễn).
- Ghi một lần cùng câu `INSERT`, không bao giờ sửa.

## Sửa bảng `Entitlement` (FR-040, R14)

```sql
ALTER TABLE "Entitlement"
    ADD CONSTRAINT "Entitlement_latestOrderItemId_fkey"
    FOREIGN KEY ("latestOrderItemId") REFERENCES "OrderItem" (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION;
```

Cột đã tồn tại từ migration `add_entitlement` và hiện luôn `NULL` (006 không ghi vào) nên thêm FK
không cần backfill. `schema.prisma` đổi `latestOrderItemId` từ cột trần thành relation tới
`OrderItem`, và thêm back-relation `OrderItem.Entitlement Entitlement[]`.

## Quan hệ

```text
User (customer) ─1───n─ Order ─1───1─ OrderItem ─n───1─ Product
                                         │
                                         ├─ n───1 ProductOffer (xoá mềm vẫn tham chiếu được)
                                         │
Entitlement.latestOrderItemId ───n───1───┘   (FK thêm ở migration này)
Entitlement.latestProductOfferId ─n───1─ ProductOffer
Profile.balance ← bị trừ bởi Order (không có FK; quan hệ qua "userId")
```

MVP: một `Order` có đúng **một** `OrderItem` (spec Assumptions). Ràng buộc "đúng một" không mã hoá
được ở DB bằng cách rẻ; code là nơi giữ, và unique `(orderId, productId)` đã chặn trùng Product
trong cùng đơn.

## Bất biến dữ liệu (ai giữ, giữ bằng gì)

| Bất biến                                                  | Giữ bởi                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| Một mã chống trùng chỉ sinh một đơn cho mỗi customer       | UNIQUE `(customerId, idempotencyKey)` + luồng R5                |
| Số dư không âm                                             | `updateMany ... balance >= price` (R6) trong transaction đã khoá |
| Tiền đã trừ ⇔ có đơn ⇔ có quyền                            | cả bốn thao tác nằm trong một transaction (FR-002)              |
| Mỗi customer một quyền cho mỗi Product                     | UNIQUE `(customerId, productId)` của 006                        |
| Suất một lần không bị dùng lại                             | `oneTimePurchasedAt` của 006 + kiểm tra ở bước 6 của R4         |
| Quyền `REVOKED` không bị kích hoạt lại khi mua             | kiểm tra ở bước 6 (FR-010) + `Entitlement_revoke_fields_check`  |
| Lịch sử giá không đổi khi Publisher sửa gói                | `offerSnapshot` bất biến + xoá mềm `ProductOffer`               |

## Trạng thái

Không có máy trạng thái: một đơn hàng sinh ra ở `PAID` và không bao giờ chuyển trạng thái. Trạng
thái quyền dùng (`ACTIVE`/`EXPIRED`/`REVOKED`) do spec 006 định nghĩa; Order chỉ đọc và kích hoạt,
không tự đổi.
