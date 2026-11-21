# Planning Notes: 007-order

**Purpose**: Các quyết định kỹ thuật và dữ kiện đã đối chiếu với codebase khi viết spec, tách khỏi
`spec.md` để spec chỉ mô tả nghiệp vụ. Dùng làm đầu vào cho `/speckit-plan`. Không phải quyết định
cuối — plan có thể điều chỉnh kèm lý do.

**Source**: `a2matex-docs/components/a2matex-backend/db_design/04_commerce_entitlement_execution.md`
§2–§4; code thật trong repo (xem "Đã đối chiếu với codebase"); và
[`006-entitlement`](../006-entitlement/) (spec, research, contracts, code đã triển khai).

## Đã đối chiếu với codebase (2026-11-21)

Những dữ kiện dưới đây đọc trực tiếp từ code đang chạy, không phải giả định:

### Product Offer (`src/routes/product-offer/`, `prisma/schema.prisma`)

- Cột là `type` (không phải `offerType`), `priceAmount BigInt`, `durationDays Int?`, xoá mềm bằng
  `deletedAt`. `offerType` chỉ là tên field trong JSON snapshot của OrderItem.
- **Danh tính của một gói là `(type, durationDays)`** — `naturalKeyOf()` trong
  `product-offer.model.ts`; giá **không** thuộc danh tính. Hệ quả cho Order: Publisher đổi giá thì
  gói giữ nguyên `id`, lần mua chỉ thấy giá mới. Gói chỉ biến mất khi Publisher bỏ hẳn tổ hợp
  loại + thời lượng đó khỏi bảng giá thay thế.
- Gói cũ bị **xoá mềm** (`deletedAt`, `deletedById`), không xoá cứng → FK từ `OrderItem` và từ
  `Entitlement.latestProductOfferId` luôn còn hợp lệ.
- `SUBSCRIPTION` bắt buộc `priceAmount > 0` và `durationDays != null`; `ONE_TIME` được phép giá 0
  và/hoặc `durationDays = null` (`ProductOfferInput.superRefine`).
- Product `ACTIVE` bắt buộc còn ít nhất một gói `SUBSCRIPTION`
  (`ProductSubscriptionOfferRequiredException`, `assertActivationReady`).
- Marketplace công khai: `GET /marketplace/products` trả `minimumSubscriptionOffer`,
  `GET /marketplace/products/:productId` trả `offers: ProductOfferOutput[]` — đây là nơi client lấy
  `productOfferId` để gửi lên khi mua.

### Số dư (`prisma/schema.prisma`, `src/routes/topup/`)

- `Profile.balance BigInt @default(0)`, nằm trên `Profile` (khoá theo `userId`, xoá mềm).
- Nạp tiền cộng bằng `balance: { increment: amount }` trong `topup.repo.ts` → Order trừ tiền phải
  dùng cập nhật có điều kiện trên cùng row, không đọc-rồi-ghi.

### Entitlement (006, đã triển khai và verify 2026-11-21)

Hai method public, **không** tự mở transaction (tham gia transaction của caller qua
`TransactionContext`):

```ts
lockForPurchase({ customerId, productId }):
  Promise<{ id, status, expiresAt, oneTimePurchasedAt } | null>

activateFromOrder({ customerId, productId, orderItemId, productOfferId,
                    offerType, durationDays, now }):
  Promise<{ id, startsAt, expiresAt }>
```

- JSDoc của `lockForPurchase` ghi rõ: chỉ gọi sau khi caller đã khoá Product → ProductOffer →
  Profile.
- `activateFromOrder` tính `expiresAt = now + durationDays` (null ⇒ vĩnh viễn), set
  `oneTimePurchasedAt` lần đầu bằng `COALESCE(cũ, mới)`, **không** ghi audit entry (FR-041 của 006).
- **Bẫy đã kiểm chứng**: `upsertFromOrder` cố ý không xoá `revokedAt/revokedById/revokedReason`.
  Gọi `activateFromOrder` trên quyền đang `REVOKED` ⇒ `Entitlement_revoke_fields_check` chặn ⇒
  transaction abort ⇒ 500. Vì vậy Order **phải** tự chặn `REVOKED` trước (FR-010 của spec này);
  `lockForPurchase` đã trả `status` nên không cần đổi contract.
- `EntitlementModule` export `EntitlementService`; comment trong module ghi rõ Order import
  Entitlement, không bao giờ ngược lại.
- Cột `Entitlement.latestOrderItemId` hiện **chưa có FK** (006 research R8) — migration của 007 là
  nơi thêm `REFERENCES "OrderItem"(id)`.

### Idempotency (`src/shared/decorators/idempotency-key.decorator.ts`, `src/routes/submission/`)

- Decorator `@IdempotencyKey('Error.XxxIdempotencyKeyRequired')` đã có: đọc header
  `Idempotency-Key`, trim, validate `z.uuid()`, ném `422` với message truyền vào.
- Pattern của `SubmissionService.create`: (1) tra key trước khi làm gì; (2) nếu đã có bản ghi, so
  input bằng hash canonical để phân biệt "gửi lại y hệt" với "dùng lại key cho yêu cầu khác";
  (3) khi thất bại thì tra lại key một lần nữa để bắt request đồng thời vừa commit; (4) unique
  `(createdById, idempotencyKey)` là lớp chặn cuối.
- Order chỉ có một trường đầu vào (`productOfferId`) nên bước (2) chỉ cần so `productOfferId` của
  dòng hàng, không cần hash canonical.

## Data model đề xuất

Theo `db_design/04` §3, với các điều chỉnh:

- `Order`: `id`, `customerId → User(id)`, `status`, `totalAmount BIGINT`, `paidAt`,
  `idempotencyKey`, `createdAt`, `updatedAt`.
  - CHECK `status <> 'PAID' OR "paidAt" IS NOT NULL` (theo docs).
  - UNIQUE `(customerId, idempotencyKey)` — docs chưa có, spec này thêm (FR-021).
- `OrderItem`: `id`, `orderId → Order(id)`, `productId → Product(id)`,
  `productOfferId → ProductOffer(id)`, `unitPriceAmount BIGINT`, `offerSnapshot JSONB`, `createdAt`.
  - UNIQUE `(orderId, productId)`, CHECK `jsonb_typeof("offerSnapshot") = 'object'`.
  - `offerSnapshot` versioned:
    `{"schemaVersion":"1.0","offerType":"SUBSCRIPTION","priceAmount":"50000","durationDays":30}`.
- Thêm FK `Entitlement.latestOrderItemId → OrderItem(id)` (FR-040).
- **Quyết định để plan chốt**: docs định nghĩa `OrderStatus` 4 giá trị
  (`PENDING|PAID|CANCELLED|FAILED`) nhưng MVP chỉ tạo `PAID` (thất bại thì rollback, không lưu).
  Theo Constitution VI (YAGNI), cân nhắc enum chỉ có `PAID`, giống cách 006 chỉ giữ
  `ACTIVE|REVOKED` và suy ra `EXPIRED` lúc đọc. Nếu giữ đủ 4 giá trị thì phải nói rõ ai tạo ra
  chúng, nếu không thì enum có giá trị chết.

## Thứ tự khoá (thống nhất toàn hệ thống)

`Product → ProductOffer → Profile (customer) → Entitlement`

Vì client chỉ gửi `productOfferId`:

1. Đọc gói **không khoá** để lấy `productId`.
2. `SELECT ... FROM "Product" WHERE id = $1 AND "deletedAt" IS NULL FOR UPDATE` (kèm
   `(EXTRACT(EPOCH FROM now()) * 1000)::bigint AS "transactionNowMs"` để lấy `now` của transaction,
   theo `entitlement.repo.ts`/`product-offer.repo.ts`).
3. Khoá lại chính gói đó và **kiểm tra lại** `deletedAt IS NULL` và `productId` khớp — giữa bước 1
   và bước 2 Publisher có thể đã thay bảng giá.
4. Khoá `Profile` của customer (`FOR UPDATE OF p`, join `User` kiểm tra `deletedAt`), giống
   `EntitlementRepo.lockCustomerProfile`. Khoá này tuần tự hoá mọi lần mua của cùng customer.
5. `EntitlementService.lockForPurchase` (khoá row Entitlement nếu có).

Lần tra mã chống trùng thứ hai nằm **sau** bước 4: khi đó request trùng key đến sau chắc chắn thấy
được đơn hàng mà request trước đã commit.

## Trừ số dư

```sql
UPDATE "Profile"
SET balance = balance - $price, "updatedAt" = now()
WHERE "userId" = $customerId AND "deletedAt" IS NULL AND balance >= $price
```

0 row ảnh hưởng ⇒ `Error.InsufficientBalance`. Không đọc balance rồi ghi lại.

## Error contract đề xuất

| Điều kiện                                             | Kết quả                                  | Thay đổi dữ liệu |
| ----------------------------------------------------- | ---------------------------------------- | ---------------- |
| Body sai / `productOfferId` không phải UUID            | `422` validation                         | không            |
| Thiếu hoặc sai `Idempotency-Key`                       | `422 Error.OrderIdempotencyKeyRequired`  | không            |
| Key đã dùng cho gói khác                               | `409 Error.OrderIdempotencyKeyReused`    | không            |
| Key đã dùng cho cùng gói                               | `200` trả lại đơn cũ                     | không            |
| Gói không tồn tại / đã bỏ khỏi bảng giá                | `404 Error.ProductOfferNotFound`         | không            |
| Product không tồn tại / đã xoá                         | `404 Error.ProductNotFound` (dùng lại)   | không            |
| Product không `ACTIVE`                                 | `409 Error.ProductNotPurchasable`        | không            |
| Quyền đang `REVOKED`                                   | `409 Error.EntitlementRevoked`           | không            |
| Quyền còn hiệu lực                                     | `409 Error.EntitlementStillActive`       | không            |
| Đã dùng suất `ONE_TIME` của Product                    | `409 Error.OneTimeOfferAlreadyUsed`      | không            |
| Số dư không đủ                                         | `409 Error.InsufficientBalance`          | không            |
| Customer không có Profile                              | `404 Error.OrderCustomerProfileNotFound` | không            |
| Hết thời gian chờ khoá / deadlock                      | `503 Error.OrderOperationTimeout`        | rollback         |

Quy ước: hằng exception khai báo trong `order.error.ts` theo mẫu `product-offer.error.ts` và
`entitlement.error.ts`; dùng lại `ProductNotFoundException` của `product.error.ts` thay vì tạo mới.

## Route đề xuất

| Method | Path               | Actor    | Ghi chú                                            |
| ------ | ------------------ | -------- | -------------------------------------------------- |
| POST   | `/orders`          | CUSTOMER | body `{ productOfferId }` + header `Idempotency-Key` |
| GET    | `/orders/me`       | CUSTOMER | phân trang, không dùng scope `OWN` (theo 006 R6)   |
| GET    | `/orders/:orderId` | CUSTOMER | lọc theo `customerId` của token; khác chủ ⇒ `404`  |

Triển khai kèm: seed permission trong cùng PR (Constitution II) và bước vận hành gán 3 permission
này cho role `CUSTOMER` (API `PUT /roles/:id/permissions` thay **toàn bộ** tập — phải gửi danh sách
cũ + id mới), đúng như bước đã làm cho `GET /entitlements/me` ở 006.

## Ghi chú triển khai khác

- Số tiền trả ra dạng decimal string qua `zBigIntAsString` (`src/shared/utils/zod.ts`); BigInt không
  sống sót `JSON.stringify`.
- Bắt lỗi timeout/deadlock của Prisma bằng `isTransactionTimeoutPrismaError` (và cân nhắc retry có
  giới hạn như `product-offer.repo.ts`); unique violation của `(customerId, idempotencyKey)` là lớp
  chặn cuối, xử lý bằng cách tra lại key rồi trả đơn cũ.
- Unit test co-located `src/routes/order/test/` (Vitest), mock repo + `TransactionService` như
  `entitlement.service.spec.ts`.
- Kiểm chứng thủ công chạy trên DB local trong container và API chạy từ `dist`
  (`npm run start:prod`): `start:dev` dùng `tsx` nên không emit decorator metadata, DTO không được
  validate và mọi case `422` sẽ sai.
- Migration viết tay theo mẫu `20261121090000_add_entitlement/migration.sql`, phải apply sạch trên
  database rỗng và `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma`
  phải trả "No difference detected"; nhớ `npm run prisma:generate` trước khi build.
