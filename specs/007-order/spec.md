# Feature Specification: Order — mua Product bằng balance

**Feature Branch**: `007-order`

**Created**: 2026-11-21

**Status**: Draft

**Input**: User description: "Viết spec cho Order Module: customer mua Product Offer bằng
`Profile.balance`, kể cả zero-value Order; snapshot Offer; block mua khi Entitlement còn hiệu lực
hoặc bị REVOKED; ONE_TIME một lần/customer/Product; có idempotency key; tạo/kích hoạt lại
Entitlement atomically."

**Related spec**: [`006-entitlement`](../006-entitlement/spec.md) — Order dùng contract nội bộ
FR-011 của Entitlement trong cùng transaction mua. Spec 006 PHẢI triển khai trước hoặc cùng lúc.

## Clarifications

### Session 2026-11-21

- Q: Thanh toán bằng gì? → A: Chỉ bằng `Profile.balance`. Mua là trừ thẳng balance trong cùng
  transaction; không có Payment callback, không có `PaymentTransaction`. TopUp/SePay chỉ dùng để nạp
  balance trước đó.
- Q: Có cần idempotency key không? → A: Có. Client gửi header `Idempotency-Key` (UUID) cho mỗi lần
  bấm mua; key lưu trên Order, unique theo (customer, key). Gửi lại cùng key trả lại Order cũ,
  không trừ tiền lần hai. Theo cùng cách làm của Submission.
- Q: Customer có Entitlement `REVOKED` có mua lại được không? → A: Không — bị chặn
  `Error.EntitlementRevoked`; chỉ Admin grant gỡ được (spec 006).
- Q: Ghi nhận doanh thu/payout cho Publisher? → A: Ngoài phạm vi; để spec sau.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Mua gói SUBSCRIPTION bằng balance (Priority: P1)

Customer đã nạp tiền vào balance, chọn một gói subscription (ví dụ 30 ngày) của Product và bấm
mua. Balance bị trừ đúng giá gói, Product xuất hiện trong My Products với hạn 30 ngày.

**Why this priority**: là luồng doanh thu chính; Product `ACTIVE` bắt buộc có ít nhất một
`SUBSCRIPTION` Offer nên mọi Product bán được đều đi qua luồng này.

**Independent Test**: customer có balance 100.000, mua Offer subscription 30 ngày giá 50.000 →
balance còn 50.000, có một Order `PAID` với OrderItem snapshot đúng giá/thời hạn, Entitlement
`ACTIVE` hết hạn sau 30 ngày.

**Acceptance Scenarios**:

1. **Given** Product `ACTIVE`, Offer subscription hợp lệ, balance ≥ giá, chưa có Entitlement,
   **When** customer mua, **Then** balance giảm đúng giá; tạo Order `PAID` (`paidAt`, `totalAmount`)
   và một OrderItem (`productId`, `productOfferId`, `unitPriceAmount`, `offerSnapshot`); Entitlement
   được tạo với `startsAt = now`, `expiresAt = now + durationDays`, `grantSource = ORDER`.
2. **Given** balance < giá, **When** customer mua, **Then** bị từ chối `Error.InsufficientBalance`;
   không có Order, balance và Entitlement không đổi.
3. **Given** Entitlement còn hạn (dù từ Order hay Admin grant), **When** customer mua bất kỳ Offer
   nào, **Then** bị từ chối `Error.EntitlementStillActive` — không gia hạn, không cộng dồn, không
   đổi gói.
4. **Given** Entitlement đã hết hạn, **When** customer mua subscription, **Then** cùng row
   Entitlement được kích hoạt lại với kỳ mới tính từ thời điểm mua (không nối tiếp kỳ cũ).
5. **Given** Publisher vừa đổi giá Offer sau khi customer mở trang, **When** customer mua, **Then**
   Order dùng giá hiện tại trong DB, không dùng giá client đang thấy.

---

### User Story 2 - Nhận gói ONE_TIME (miễn phí hoặc trả tiền) (Priority: P1)

Customer dùng thử miễn phí hoặc mua gói một lần (khuyến mãi, gói giới thiệu, hoặc vĩnh viễn). Mỗi
customer chỉ được nhận gói ONE_TIME một lần cho mỗi Product, bất kể Publisher tạo bao nhiêu Offer
ONE_TIME.

**Why this priority**: checklist MVP ưu tiên Product miễn phí; acquisition giá 0 đi chung đường
Order nên phải đúng ngay từ đầu.

**Independent Test**: customer balance 0 nhận Offer ONE_TIME giá 0 thời hạn 7 ngày → có Order
`PAID` `totalAmount = 0`, Entitlement 7 ngày, `oneTimePurchasedAt` được set; sau khi hết hạn, mua
lại một Offer ONE_TIME khác của cùng Product bị từ chối.

**Acceptance Scenarios**:

1. **Given** Offer ONE_TIME giá 0, **When** customer có balance 0 nhận, **Then** thành công; vẫn
   tạo Order và OrderItem giá 0; balance không đổi.
2. **Given** Offer ONE_TIME `durationDays = null`, **When** mua thành công, **Then** Entitlement có
   `expiresAt = null` (vĩnh viễn).
3. **Given** customer đã từng nhận ONE_TIME của Product (`oneTimePurchasedAt` khác null) và quyền đã
   hết hạn, **When** mua bất kỳ Offer ONE_TIME nào của Product đó, **Then** bị từ chối
   `Error.OneTimeOfferAlreadyUsed`.
4. **Given** customer đã từng nhận ONE_TIME và quyền đã hết hạn, **When** mua SUBSCRIPTION, **Then**
   thành công.
5. **Given** customer từng có SUBSCRIPTION đã hết hạn nhưng chưa từng nhận ONE_TIME, **When** nhận
   ONE_TIME, **Then** thành công.

---

### User Story 3 - Bấm mua hai lần / mạng chập chờn không bị trừ tiền hai lần (Priority: P1)

Customer bấm "Mua", mạng chập chờn nên client gửi lại request (hoặc customer bấm đúp). Customer chỉ
bị trừ tiền một lần và nhận lại đúng Order đã tạo.

**Why this priority**: trừ tiền trùng là lỗi mất tiền thật của customer; phải đúng ngay từ bản đầu.

**Independent Test**: gửi hai request song song cùng `Idempotency-Key` → cả hai trả cùng Order id,
balance chỉ giảm một lần, chỉ có một Order trong DB.

**Acceptance Scenarios**:

1. **Given** Order đã tạo với key K, **When** gửi lại cùng key K và cùng `productOfferId`, **Then**
   trả lại Order đó với cùng response shape; không trừ tiền, không tạo Order mới.
2. **Given** Order đã tạo với key K cho Offer A, **When** gửi key K cho Offer B, **Then** bị từ chối
   `409 Error.OrderIdempotencyKeyReused`.
3. **Given** request với key K thất bại (ví dụ thiếu balance), **When** customer nạp thêm tiền rồi
   gửi lại cùng key K, **Then** request được xử lý như mới và có thể thành công (thất bại không để lại
   dấu vết).
4. **Given** hai request đồng thời cùng key K, **When** request đến sau thua do rule nghiệp vụ (ví
   dụ `EntitlementStillActive` vì request đầu vừa tạo quyền), **Then** request đó vẫn trả lại Order
   của key K thay vì lỗi.
5. **Given** thiếu header hoặc không phải UUID, **Then** `422 Error.OrderIdempotencyKeyRequired`.

---

### User Story 4 - Xem lịch sử mua hàng (Priority: P2)

Customer xem danh sách Order của mình và chi tiết từng Order, với giá và điều khoản đúng như lúc
mua, kể cả khi Publisher đã đổi giá hoặc xoá Offer.

**Why this priority**: cần cho hỗ trợ và tranh chấp, nhưng không chặn luồng mua.

**Independent Test**: mua Offer giá 50.000, Publisher đổi giá thành 70.000 rồi xoá Offer → lịch sử
vẫn hiển thị 50.000 và thời hạn cũ.

**Acceptance Scenarios**:

1. **Given** customer có nhiều Order, **When** xem danh sách, **Then** nhận danh sách phân trang,
   mới nhất trước, mỗi item có `id`, `status`, `totalAmount`, `paidAt`, Product (id, tên hiện tại)
   và `offerSnapshot`.
2. **Given** customer xem chi tiết Order của người khác, **Then** `404 Error.OrderNotFound` (không
   phân biệt với không tồn tại).
3. **Given** customer bị Admin revoke Entitlement, **When** xem lịch sử, **Then** vẫn thấy đầy đủ
   Order cũ.

---

### Edge Cases

- Product `DRAFT`, `ARCHIVED`, `SUSPENDED` hoặc đã xoá: chặn mua (`Error.ProductNotPurchasable`, hoặc
  `404` nếu đã xoá).
- Offer đã soft-delete hoặc không thuộc Product: `404 Error.ProductOfferNotFound`.
- Publisher thay Offer đồng thời với Order: cả hai khoá Product trước; bên nào lấy được khoá trước
  thì hoàn tất, bên kia thấy dữ liệu đã commit và kiểm tra lại (Offer có thể đã bị xoá → 404, hoặc
  giá mới được dùng).
- Hai Order khác key, khác Offer, cùng (customer, Product), chạy đồng thời: chỉ một thành công; bên
  kia nhận `EntitlementStillActive` và không bị trừ tiền.
- Hai Order đồng thời của cùng customer cho hai Product khác nhau, balance chỉ đủ cho một: chỉ một
  thành công; balance không bao giờ âm.
- Order đồng thời với TopUp cộng balance: không mất cập nhật nào (cả hai đều là cập nhật nguyên tử
  trên cùng row Profile).
- Entitlement `REVOKED` mà `expiresAt` còn hạn hoặc đã hết hạn: đều chặn `Error.EntitlementRevoked`
  (kiểm tra trước rule còn hạn).
- Entitlement `ACTIVE` từ Admin grant vĩnh viễn: luôn bị chặn `EntitlementStillActive`.
- Publisher mua Product của chính mình: được xử lý như customer bình thường (không ưu đãi).
- User không có Profile: `404 Error.ProfileNotFound`.

## Requirements *(mandatory)*

### Functional Requirements

**Tạo Order**

- **FR-001**: Customer đã đăng nhập PHẢI tạo được Order với body chỉ gồm `productOfferId` và header
  `Idempotency-Key`. Server KHÔNG nhận giá, thời hạn, loại gói hay `productId` từ client.
- **FR-002**: Toàn bộ quá trình mua PHẢI nằm trong **một** database transaction: hoặc tất cả thay đổi
  (trừ balance, Order, OrderItem, Entitlement) được commit, hoặc không có gì.
- **FR-003**: Trong transaction, server PHẢI đọc lại và khoá Product và Offer hiện tại, rồi kiểm tra
  theo đúng thứ tự sau (lỗi đầu tiên gặp phải được trả về):
  1. Offer tồn tại, chưa xoá; Product của Offer tồn tại, chưa xoá → nếu không: `404`.
  2. Product `ACTIVE` → nếu không: `409 Error.ProductNotPurchasable`.
  3. Entitlement (nếu có) không `REVOKED` → nếu không: `409 Error.EntitlementRevoked`.
  4. Không có quyền còn hiệu lực: `entitlement == null || (expiresAt != null && expiresAt ≤ now)`
     → nếu không: `409 Error.EntitlementStillActive`.
  5. Nếu Offer là `ONE_TIME`: `oneTimePurchasedAt IS NULL` → nếu không:
     `409 Error.OneTimeOfferAlreadyUsed`. Khoá once-only là (customer, Product), không phải Offer id.
  6. `balance ≥ priceAmount` → nếu không: `409 Error.InsufficientBalance`.
- **FR-004**: Trừ balance PHẢI là cập nhật nguyên tử có điều kiện (`balance ≥ price`) trên row
  Profile; balance KHÔNG BAO GIỜ được âm.
- **FR-005**: Order thành công PHẢI được tạo ở trạng thái `PAID` với `paidAt = now`,
  `totalAmount = priceAmount`. MVP không tạo Order `PENDING/FAILED/CANCELLED`; thất bại thì rollback.
- **FR-006**: Mỗi Order có đúng một OrderItem gồm `productId`, `productOfferId`, `unitPriceAmount`
  và `offerSnapshot` versioned bất biến:
  `{"schemaVersion":"1.0","offerType":"...","priceAmount":"...","durationDays":N|null}`.
- **FR-007**: Acquisition giá 0 PHẢI đi đúng đường trên và tạo Order/OrderItem giá 0.
- **FR-008**: Sau khi tạo OrderItem, Order PHẢI gọi contract Entitlement FR-011 (spec 006) trong
  cùng transaction để tạo mới hoặc kích hoạt lại Entitlement:
  `startsAt = now`, `expiresAt = now + durationDays` hoặc null, không cộng dồn kỳ cũ; set
  `oneTimePurchasedAt` nếu là `ONE_TIME` lần đầu.
- **FR-009**: `now` PHẢI là thời điểm của database transaction, dùng nhất quán cho mọi so sánh và
  timestamp trong cùng lần mua.
- **FR-010**: Không có stacking, gia hạn sớm, nâng/hạ gói, proration, hoàn tiền hay thanh toán định
  kỳ tự động.

**Idempotency**

- **FR-020**: Header `Idempotency-Key` là bắt buộc và PHẢI là UUID (dùng decorator
  `@IdempotencyKey` hiện có). Thiếu/sai → `422 Error.OrderIdempotencyKeyRequired`.
- **FR-021**: Order PHẢI lưu `idempotencyKey`, unique theo `(customerId, idempotencyKey)`. Key được
  giữ vĩnh viễn cùng Order (không có thời hạn hết hiệu lực).
- **FR-022**: Trước khi mua, nếu đã có Order với `(customer, key)`: cùng `productOfferId` → trả lại
  Order đó (cùng response shape, không side effect); khác `productOfferId` →
  `409 Error.OrderIdempotencyKeyReused`.
- **FR-023**: Khi lần mua thất bại vì **bất kỳ** lý do nào, server PHẢI tra lại key một lần nữa;
  nếu đã có Order cho key đó (do request đồng thời vừa commit), trả lại Order đó theo FR-022 thay
  vì lỗi.
- **FR-024**: Lần mua thất bại KHÔNG để lại bản ghi nào cho key; client có thể dùng lại key đó.

**Đọc Order**

- **FR-030**: Customer PHẢI xem được danh sách Order của chính mình có phân trang, sắp xếp mới nhất
  trước.
- **FR-031**: Customer PHẢI xem được chi tiết một Order của mình; Order của người khác hoặc không
  tồn tại đều trả `404 Error.OrderNotFound`.
- **FR-032**: Response Order gồm `id`, `status`, `totalAmount` (decimal string), `paidAt`,
  `createdAt`, item (`productId`, tên Product hiện tại, `productOfferId`, `unitPriceAmount`,
  `offerSnapshot`). Response tạo Order kèm thêm Entitlement kết quả (trạng thái hiệu lực, `startsAt`,
  `expiresAt`). BIGINT luôn serialize thành decimal string.
- **FR-033**: Mọi route mới PHẢI có permission record và seed đi kèm cùng PR (Constitution II).

Gợi ý route (chốt ở plan):

| Method | Path               | Actor    | Scope |
| ------ | ------------------ | -------- | ----- |
| POST   | `/orders`          | CUSTOMER | —     |
| GET    | `/orders/me`       | CUSTOMER | OWN   |
| GET    | `/orders/:orderId` | CUSTOMER | OWN   |

### Error contract

| Điều kiện                                            | Kết quả                                   | Thay đổi |
| ---------------------------------------------------- | ----------------------------------------- | -------- |
| Body sai định dạng / `productOfferId` không phải UUID | `422` validation error                    | không    |
| Thiếu hoặc sai `Idempotency-Key`                      | `422 Error.OrderIdempotencyKeyRequired`   | không    |
| Key đã dùng cho Offer khác                            | `409 Error.OrderIdempotencyKeyReused`     | không    |
| Key đã dùng cho cùng Offer                            | trả lại Order cũ                          | không    |
| Offer không tồn tại / đã xoá                          | `404 Error.ProductOfferNotFound`          | không    |
| Product không tồn tại / đã xoá                        | `404 Error.ProductNotFound`               | không    |
| Product không `ACTIVE`                                | `409 Error.ProductNotPurchasable`         | không    |
| Entitlement `REVOKED`                                 | `409 Error.EntitlementRevoked`            | không    |
| Entitlement còn hiệu lực                              | `409 Error.EntitlementStillActive`        | không    |
| ONE_TIME đã dùng cho Product                          | `409 Error.OneTimeOfferAlreadyUsed`       | không    |
| Không đủ balance                                      | `409 Error.InsufficientBalance`           | không    |
| User không có Profile                                 | `404 Error.ProfileNotFound`               | không    |
| Lỗi serialization/deadlock                            | retry có giới hạn, sau đó lỗi tạm thời    | rollback |

### Key Entities *(include if feature involves data)*

- **Order** (mới): một giao dịch mua bằng balance của customer — `customerId`, `status`,
  `totalAmount`, `paidAt`, `idempotencyKey` (unique theo customer), `createdAt`. Không sửa sau khi tạo.
- **OrderItem** (mới): dòng hàng bất biến của Order — `orderId`, `productId`, `productOfferId`,
  `unitPriceAmount`, `offerSnapshot`. Unique `(orderId, productId)`. Tham chiếu Offer kể cả khi Offer
  đã soft-delete.
- **Profile** (đã có): `balance` bị trừ khi mua.
- **Entitlement** (spec 006): được tạo/kích hoạt lại; `latestOrderItemId` trỏ về OrderItem mới.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 0 trường hợp customer bị trừ tiền hai lần cho cùng một `Idempotency-Key`, kể cả khi
  gửi đồng thời.
- **SC-002**: 0 trường hợp balance âm, hoặc balance bị trừ mà không có Order/Entitlement tương ứng
  (và ngược lại).
- **SC-003**: 0 trường hợp một customer nhận ONE_TIME hai lần cho cùng một Product.
- **SC-004**: 0 trường hợp customer mua được khi Entitlement còn hiệu lực hoặc đang `REVOKED`.
- **SC-005**: 100% OrderItem hiển thị đúng giá/thời hạn tại thời điểm mua sau khi Publisher sửa
  hoặc xoá Offer.
- **SC-006**: Sau khi mua thành công, Product xuất hiện trong My Products ngay ở request tiếp theo.

## Assumptions

- Đơn vị tiền là integer system-currency giống `Profile.balance` (BIGINT), không dùng số thực.
- Mọi user đăng nhập đều có role `CUSTOMER` và một Profile; user `BANNED` đã bị chặn ở tầng auth.
- Mỗi Order chỉ có một OrderItem trong MVP (không có giỏ hàng).
- Admin xem/quản lý Order, hoàn tiền, coupon, ghi nhận doanh thu và payout cho Publisher nằm ngoài
  phạm vi.
- Tên Product trong lịch sử là tên hiện tại (join), không snapshot; điều khoản thương mại mới cần
  snapshot.
- Không cập nhật tài liệu trong `a2matex-docs` trong phạm vi spec này; docs được cập nhật sau khi
  code hoàn tất và test xong.

## Ghi chú cho `/speckit-plan`

- Thứ tự khoá (chung với Product Offer và Entitlement):
  `Product → ProductOffer → Profile (customer) → Entitlement`. Vì client chỉ gửi `productOfferId`,
  đọc Offer không khoá để lấy `productId`, sau đó khoá Product, rồi khoá Offer và kiểm tra lại
  `deletedAt`/`productId`.
- Kiểm tra key lần hai nằm sau khi khoá `Profile`: khoá này tuần tự hoá mọi Order của cùng customer,
  nên request trùng key đến sau sẽ thấy Order đã commit. Unique constraint là lớp chặn cuối.
- Trừ balance:
  `UPDATE "Profile" SET balance = balance - $price WHERE "userId" = $id AND balance >= $price`,
  0 row ảnh hưởng ⇒ `InsufficientBalance`.
- Tham khảo `SubmissionService.create` cho pattern idempotency (kiểm tra trước, probe lại khi thất
  bại, phân biệt cùng/khác request).
- Bắt lỗi serialization/deadlock và retry có giới hạn như product-offer repository.
- Migration chỉ lấy `OrderStatus`, `Order`, `OrderItem` và FK `Entitlement.latestOrderItemId` (nếu
  chưa có từ 006).
