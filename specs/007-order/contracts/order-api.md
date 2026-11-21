# Contract: Order API

Prefix `API_PREFIX_PATH` như mọi route khác. Cả ba route cần Bearer access token
(`AccessTokenGuard`) và permission record gán cho role `CUSTOMER` (Constitution II,
[research.md](../research.md) R10). DTO dùng `nestjs-zod`; lỗi theo envelope hiện có
`{ message, error, statusCode }`. Thời gian là ISO 8601 UTC. Mọi số tiền là **decimal string**
(R11).

Kiểu dùng chung:

```ts
type OrderStatus = 'PAID';                                   // R3
type OfferType = 'ONE_TIME' | 'SUBSCRIPTION';
type EffectiveStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';     // định nghĩa ở spec 006
type Page<T> = { items: T[]; totalItems: number; page: number; pageSize: number; totalPages: number };

type OfferSnapshot = {
  schemaVersion: '1.0';
  offerType: OfferType;
  priceAmount: string;          // decimal string
  durationDays: number | null;  // null = vĩnh viễn
};

type OrderOutput = {
  id: string;
  status: OrderStatus;
  totalAmount: string;          // decimal string
  paidAt: string;
  createdAt: string;
  item: {
    id: string;
    productId: string;
    productOfferId: string;
    unitPriceAmount: string;    // decimal string
    offerSnapshot: OfferSnapshot;
    product: {
      id: string;
      name: string | null;
      slug: string | null;
      status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';   // trạng thái hiện tại, không snapshot
    };
  };
};
```

Query phân trang: `page` (mặc định 1), `limit` (mặc định 10, tối đa `ORDER_PAGE_SIZE_MAX = 100`).

---

## 1. `POST /orders` — mua (FR-001, FR-005, FR-032)

Actor: user đăng nhập (role `CUSTOMER`). Mua cho chính `userId` trong token.

Header bắt buộc: `Idempotency-Key: <uuid>` — đọc bằng `@IdempotencyKey('Error.OrderIdempotencyKeyRequired')`,
khai báo cho Swagger bằng `@ApiHeader({ name: IDEMPOTENCY_KEY_HEADER, required: true })` như
`SubmissionController.create`.

Body (strict):

```ts
{ productOfferId: string /* uuid */ }
```

Không có trường nào khác. Giá, thời lượng, loại gói và Product đều do server đọc lại (FR-001).

`200` (dùng `@HttpCode(200)`, cả lần mua đầu lẫn lần replay đều trả shape này — FR-022):

```ts
OrderOutput & {
  entitlement: {
    id: string;
    status: EffectiveStatus;    // lần mua thành công luôn là ACTIVE
    startsAt: string;
    expiresAt: string | null;
  };
}
```

Khối `entitlement` dựng bằng `EntitlementService.findSummaryForOrder` (R8) nên lần replay phản ánh
**trạng thái quyền hiện tại**, không phải trạng thái lúc mua.

Thứ tự kiểm tra và lỗi: xem bảng ở mục 4 (đúng thứ tự FR-003).

---

## 2. `GET /orders/me` — lịch sử của tôi (FR-030)

Actor: user đăng nhập. Chỉ trả đơn có `customerId = token.userId`.

Query: `page`, `limit`. Sắp xếp `createdAt DESC, id ASC` (R13).

`200`: `Page<OrderOutput>` — không có khối `entitlement`.

---

## 3. `GET /orders/:orderId` — chi tiết một đơn (FR-031)

Actor: user đăng nhập. Param: `orderId` (uuid, strict).

> **Thứ tự khai báo**: route này phải nằm **sau** `@Get('me')` trong controller. NestJS khớp theo
> thứ tự khai báo; đặt trước thì `/orders/me` bị route param bắt và trả `422 Invalid UUID`.

`200`: `OrderOutput`.

`404 Error.OrderNotFound` khi đơn không tồn tại **hoặc** thuộc customer khác — truy vấn lọc
`customerId = token.userId` nên hai trường hợp không phân biệt được từ bên ngoài.

---

## 4. Bảng lỗi (FR-003, FR-020–024)

Thứ tự trong bảng là thứ tự kiểm tra thật; lỗi đầu tiên gặp phải được trả về.

| # | Điều kiện                                               | Mã lỗi                                     | HTTP | Thay đổi dữ liệu |
| - | -------------------------------------------------------- | ------------------------------------------ | ---- | ---------------- |
| — | Body sai / `productOfferId` không phải uuid / field thừa  | validation (`CustomZodValidationPipe`)     | 422  | không            |
| — | Thiếu hoặc sai `Idempotency-Key`                          | `Error.OrderIdempotencyKeyRequired`        | 422  | không            |
| 0 | Đã có đơn của `(customer, key)` với **cùng** gói          | — (trả lại đơn cũ)                         | 200  | không            |
| 0 | Đã có đơn của `(customer, key)` với gói **khác**          | `Error.OrderIdempotencyKeyReused`          | 409  | không            |
| 1 | Gói không tồn tại / đã bị bỏ khỏi bảng giá / khác Product | `Error.ProductOfferNotFound`               | 404  | không            |
| 1 | Product của gói không tồn tại hoặc đã xoá                 | `Error.ProductNotFound` (dùng lại của `product.error.ts`) | 404 | không |
| 2 | Product không ở trạng thái đang bán                       | `Error.ProductNotPurchasable`              | 409  | không            |
| 3 | Customer chưa có hồ sơ (nơi giữ số dư)                    | `Error.OrderCustomerProfileNotFound`       | 404  | không            |
| 4 | Quyền đang bị thu hồi                                     | `Error.EntitlementRevoked`                 | 409  | không            |
| 5 | Quyền còn hiệu lực                                        | `Error.EntitlementStillActive`             | 409  | không            |
| 6 | Gói một lần và customer đã dùng suất một lần              | `Error.OneTimeOfferAlreadyUsed`            | 409  | không            |
| 7 | Số dư không đủ                                            | `Error.InsufficientBalance`                | 409  | không            |
| — | Hết thời gian chờ khoá (`P2028`)                          | `Error.OrderOperationTimeout`              | 503  | rollback         |
| — | Đơn không tồn tại hoặc của người khác (route 3)           | `Error.OrderNotFound`                      | 404  | không            |

> Thứ tự 3 (hồ sơ) nằm trước 4–7 vì bước khoá `Profile` của R4 vừa là điều kiện tồn tại hồ sơ vừa là
> khoá tuần tự hoá; nhóm 4–6 đúng thứ tự FR-003.

Exception khai báo dạng hằng trong `src/routes/order/order.error.ts`, theo mẫu
`entitlement.error.ts` / `product-offer.error.ts`:

```ts
OrderIdempotencyKeyReusedException     = new ConflictException('Error.OrderIdempotencyKeyReused')
ProductOfferNotFoundException          = new NotFoundException('Error.ProductOfferNotFound')
ProductNotPurchasableException         = new ConflictException('Error.ProductNotPurchasable')
OrderCustomerProfileNotFoundException  = new NotFoundException('Error.OrderCustomerProfileNotFound')
EntitlementRevokedException            = new ConflictException('Error.EntitlementRevoked')
EntitlementStillActiveException        = new ConflictException('Error.EntitlementStillActive')
OneTimeOfferAlreadyUsedException       = new ConflictException('Error.OneTimeOfferAlreadyUsed')
InsufficientBalanceException           = new ConflictException('Error.InsufficientBalance')
OrderNotFoundException                 = new NotFoundException('Error.OrderNotFound')
OrderOperationTimeoutException         = new ServiceUnavailableException('Error.OrderOperationTimeout')
```

`ProductNotFoundException` dùng lại từ `src/routes/product/product.error.ts`, không tạo mới (giống
006).

---

## 5. Contract nội bộ với module Entitlement (006)

Order **import** `EntitlementModule` và chỉ gọi qua `EntitlementService`; không đọc thẳng bảng
`Entitlement`. Không bao giờ có chiều ngược lại (comment trong `entitlement.module.ts`).

Đã có sẵn từ 006 — dùng nguyên, không sửa:

```ts
lockForPurchase({ customerId, productId })
  : Promise<{ id, status, expiresAt, oneTimePurchasedAt } | null>

activateFromOrder({ customerId, productId, orderItemId, productOfferId,
                    offerType, durationDays, now })
  : Promise<{ id, startsAt, expiresAt }>
```

Cả hai **không** tự mở transaction — chúng tham gia transaction của Order qua `TransactionContext`.
Gọi `lockForPurchase` **sau** khi đã khoá `Product → ProductOffer → Profile` (R4).

Thêm mới ở 007 (nằm trong module entitlement, R8):

```ts
findSummaryForOrder({ customerId, productId })
  : Promise<{ id: string; status: EffectiveStatus; startsAt: Date; expiresAt: Date | null } | null>
```

- Đọc theo unique `(customerId, productId)`, tính trạng thái hiển thị bằng `now()` của DB
  (`toEffectiveStatus` sẵn có trong `entitlement.service.ts`).
- Không khoá, không ghi. Dùng cho khối `entitlement` của `POST /orders` ở cả hai đường (mua mới và
  replay).

### Ràng buộc bắt buộc khi gọi `activateFromOrder`

Chỉ được gọi khi `lockForPurchase` trả `null` **hoặc** trả row không `REVOKED` và không còn hiệu
lực. Gọi sai (trên quyền `REVOKED`) làm `Entitlement_revoke_fields_check` chặn và huỷ cả
transaction — lỗi 500 thay vì lý do nghiệp vụ (FR-010, R7).
