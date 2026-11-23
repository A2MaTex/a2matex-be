# Data Model: 007-order

Nguồn: spec FR-005, FR-006, FR-021, FR-033, FR-040; quyết định ở [research.md](./research.md)
R2, R3, R9, R11, R12, R14. Hai migration:
`prisma/migrations/20261121150000_add_order/migration.sql` (bản đầu, có bảng `OrderItem`) và
`prisma/migrations/20261123150000_flatten_order_item/migration.sql` (gộp dòng hàng vào `"Order"`).

> **Cập nhật 2026-11-23 — bỏ bảng `OrderItem`.** MVP không có giỏ hàng: customer bấm vào một
> Product rồi mua thẳng, nên một đơn luôn đúng một dòng. Ràng buộc "đúng một" vốn chỉ nằm ở code
> (`OrderItem[0]`), không ở DB. Các cột `productId`, `productOfferId`, `offerSnapshot` chuyển thẳng
> lên `"Order"`; `unitPriceAmount` biến mất vì luôn bằng `totalAmount`; `Entitlement.latestOrderItemId`
> đổi thành `latestOrderId`. **Response API không đổi**: block `item` vẫn còn, `item.id` nay chính là
> id của đơn và `item.unitPriceAmount` là `totalAmount`. Tài liệu dưới đây mô tả trạng thái **sau**
> thay đổi.

## Enum

```sql
CREATE TYPE "OrderStatus" AS ENUM ('PAID');   -- R3: MVP không bao giờ ghi PENDING/CANCELLED/FAILED
```

`ProductOfferType`, `ProductStatus`, `EntitlementStatus`, `EntitlementGrantSource` đã có.

## Bảng `Order`

> Tên bảng là từ khoá SQL — luôn viết `"Order"` trong mọi câu SQL viết tay (R9).

| Cột              | Kiểu               | Null | Ghi chú                                                      |
| ---------------- | ------------------ | ---- | ------------------------------------------------------------ |
| `id`             | UUID PK                  | no   | `gen_random_uuid()`                                    |
| `customerId`     | UUID FK → `User`         | no   | chủ đơn; không bao giờ đổi                             |
| `productId`      | UUID FK → `Product`      | no   | Product đã mua                                         |
| `productOfferId` | UUID FK → `ProductOffer` | no   | gói đã mua; vẫn hợp lệ khi gói bị xoá mềm              |
| `status`         | `OrderStatus`            | no   | default `'PAID'` (R3)                                  |
| `totalAmount`    | BIGINT                   | no   | số tiền đã trừ khỏi số dư                              |
| `offerSnapshot`  | JSONB                    | no   | bản sao bất biến điều khoản (R12)                      |
| `paidAt`         | TIMESTAMPTZ(6)           | no   | `transactionNow` của lần mua (FR-009)                  |
| `idempotencyKey` | UUID                     | no   | mã chống trùng do client sinh (R2)                     |
| `createdAt`      | TIMESTAMPTZ(6)           | no   | default `now()`                                        |

Không có `updatedAt`, `deletedAt`, `createdById`: đơn hàng bất biến, không xoá, và `customerId`
chính là người tạo. Hoàn tiền/huỷ đơn ngoài phạm vi (spec Assumptions) — khi làm sẽ thêm cột và giá
trị enum ở migration của spec đó.

### Constraint và index

```sql
CONSTRAINT "Order_customerId_idempotencyKey_key"
    UNIQUE ("customerId", "idempotencyKey")                      -- FR-021, chốt chặn cuối của R5

CONSTRAINT "Order_totalAmount_check" CHECK ("totalAmount" >= 0)  -- FR-007: giá 0 hợp lệ, âm thì không

CONSTRAINT "Order_offerSnapshot_object_check"
    CHECK (jsonb_typeof("offerSnapshot") = 'object')             -- FR-006

CREATE INDEX "Order_customerId_createdAt_idx"
    ON "Order" ("customerId", "createdAt" DESC);                 -- FR-030: lịch sử của một customer

CREATE INDEX "Order_productId_idx" ON "Order" ("productId");     -- ai đã mua Product này
```

Mọi FK dùng `ON DELETE NO ACTION ON UPDATE NO ACTION`, đúng convention các bảng hiện có.

Unique `(customerId, idempotencyKey)` cũng phục vụ luôn truy vấn tra key (R5) nên không cần index
riêng cho nó.

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
    ADD CONSTRAINT "Entitlement_latestOrderId_fkey"
    FOREIGN KEY ("latestOrderId") REFERENCES "Order" (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION;
```

Cột `latestOrderItemId` đã tồn tại từ migration `add_entitlement` và luôn `NULL` khi 007 thêm FK
nên không cần backfill. Migration `flatten_order_item` đổi tên cột thành `latestOrderId` và trỏ FK
sang `"Order"`, backfill qua `OrderItem."orderId"` trước khi bỏ bảng. `schema.prisma` giữ relation
`latestOrder Order?` và back-relation `Order.Entitlement Entitlement[]`.

## Quan hệ

```text
User (customer) ─1───n─ Order ─n───1─ Product
                          │
                          ├─ n───1 ProductOffer (xoá mềm vẫn tham chiếu được)
                          │
Entitlement.latestOrderId ─n───1──┘
Entitlement.latestProductOfferId ─n───1─ ProductOffer
Profile.balance ← bị trừ bởi Order (không có FK; quan hệ qua "userId")
```

MVP: một `Order` là **một** lần mua một Product (spec Assumptions). Không có giỏ hàng nên không có
dòng hàng riêng; muốn mua Product thứ hai thì tạo đơn thứ hai.

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
| Một đơn chỉ mua một Product                                | một hàng `"Order"` chỉ có một `productId`                       |

## Trạng thái

Không có máy trạng thái: một đơn hàng sinh ra ở `PAID` và không bao giờ chuyển trạng thái. Trạng
thái quyền dùng (`ACTIVE`/`EXPIRED`/`REVOKED`) do spec 006 định nghĩa; Order chỉ đọc và kích hoạt,
không tự đổi.
