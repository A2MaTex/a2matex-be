# Quickstart: kiểm chứng 007-order

Hướng dẫn chạy và kiểm chứng end-to-end sau khi triển khai. Không chứa code triển khai.
Tham chiếu: [contracts/order-api.md](./contracts/order-api.md), [data-model.md](./data-model.md),
[research.md](./research.md).

## 1. Chuẩn bị

```bash
npm install
npm run compose-up
npm run prisma:migrate:deploy      # gồm add_order và flatten_order_item (FK Entitlement.latestOrderId)
npm run prisma:generate            # BẮT BUỘC sau khi đổi schema, nếu không build sẽ fail
npm run seed:roles
npm run seed:permissions           # quét 3 route mới, gán ADMIN, tự xoá cache role-permission
npm run build && npm run start:prod   # API: http://localhost:9999/api/v1
```

> Chạy API từ `dist` (`start:prod`). `start:dev` dùng `tsx` nên không emit decorator metadata ⇒ DTO
> không được validate và mọi kịch bản `422` ở dưới sẽ sai.

Gán 3 permission mới (`POST /api/v1/orders`, `GET /api/v1/orders/me`,
`GET /api/v1/orders/:orderId`) cho role `CUSTOMER`, đúng cách đã làm ở 006:

1. `GET /api/v1/permissions` (token admin) → lấy `id` của ba route.
2. `GET /api/v1/roles/:customerRoleId/permissions` → lấy danh sách id hiện có.
3. `PUT /api/v1/roles/:customerRoleId/permissions` với `permissionIds` = danh sách cũ **+** ba id
   mới. API này **thay toàn bộ** tập — thiếu id cũ là customer mất quyền.

Dữ liệu cần có:

- `$ADMIN` (token admin), `$C1`/`$C2` (token customer, kèm `$C1_ID`/`$C2_ID`).
- `$P_ACTIVE`: Product `ACTIVE` có ít nhất một gói `SUBSCRIPTION` (`$OFFER_SUB`, ví dụ 30 ngày giá
  50.000) và một gói `ONE_TIME` giá 0 (`$OFFER_FREE`); thêm một gói `ONE_TIME` khác (`$OFFER_ONCE2`,
  ví dụ 7 ngày giá 10.000) để kiểm tra suất một lần.
- `$P_DRAFT`: Product `DRAFT` bất kỳ.

> **Giới hạn đổi bảng giá**: API thay bảng giá của Publisher bị chặn tần suất bởi
> `PRODUCT_OFFER_CHANGE_MAX_COUNT` (local: **2**) trong `PRODUCT_OFFER_CHANGE_WINDOW_HOURS` (local:
> **24**) đối với Product đang `ACTIVE` — vượt thì nhận `429 Error.ProductOfferChangeRateLimitExceeded`.
> Quickstart này cần ít nhất 3 lần đổi (dựng 3 gói + S7 đổi giá + S7 bỏ gói), nên: dựng đủ gói khi
> Product còn `DRAFT` rồi mới `ACTIVE`, dùng **token của Publisher sở hữu `$P_ACTIVE`** để gọi API
> gói, và khi chạm giới hạn thì reset cửa sổ trên DB local:
> `UPDATE "Product" SET "offerChangeTimestamps" = '{}' WHERE id = '<P_ACTIVE>';`

Nạp số dư cho customer (chưa có API nạp thủ công — SePay là webhook):

```sql
UPDATE "Profile" SET balance = 100000 WHERE "userId" = '<C1_ID>';
UPDATE "Profile" SET balance = 60000  WHERE "userId" = '<C2_ID>';
```

```bash
API=http://localhost:9999/api/v1
KEY() { uuidgen | tr 'A-F' 'a-f'; }      # sinh Idempotency-Key mới
```

## 2. Kịch bản

### S1 — Mua gói thuê bao (Story 1, AS1)

```bash
curl -sX POST $API/orders -H "Authorization: Bearer $C1" \
  -H "Idempotency-Key: $(KEY)" -H 'Content-Type: application/json' \
  -d "{\"productOfferId\":\"$OFFER_SUB\"}"
```

Kỳ vọng `200`: `status=PAID`, `totalAmount="50000"`, `item.offerSnapshot` đúng loại/giá/thời lượng,
`entitlement.status=ACTIVE` với `expiresAt ≈ paidAt + 30 ngày`. Kiểm tra:

- `SELECT balance FROM "Profile" WHERE "userId" = '<C1_ID>'` → `50000`.
- `GET $API/entitlements/me` bằng `$C1` → thấy Product, `ACTIVE`.
- `SELECT "latestOrderId", "latestProductOfferId", "grantSource" FROM "Entitlement" WHERE
  "customerId" = '<C1_ID>'` → trỏ đúng đơn/gói vừa tạo, `grantSource = ORDER`.

### S2 — Các trường hợp bị từ chối (Story 1, AS2–AS3, AS6; Edge Cases)

| Request (mỗi lần một `Idempotency-Key` mới)        | Kỳ vọng                                  |
| --------------------------------------------------- | ---------------------------------------- |
| Mua lại `$OFFER_SUB` khi quyền S1 còn hạn            | `409 Error.EntitlementStillActive`       |
| Mua `$OFFER_ONCE2` khi quyền S1 còn hạn              | `409 Error.EntitlementStillActive`       |
| `$C2` mua `$OFFER_SUB` (số dư 60.000 → đủ)           | `200`                                    |
| `$C2` mua tiếp gói giá cao hơn số dư còn lại         | `409 Error.InsufficientBalance`          |
| Gói thuộc `$P_DRAFT`                                 | `409 Error.ProductNotPurchasable`        |
| `productOfferId` ngẫu nhiên                          | `404 Error.ProductOfferNotFound`         |
| `productOfferId` không phải uuid                     | `422` validation                         |
| Body thừa field (`{"productOfferId":…,"price":1}`)   | `422` validation                         |
| Thiếu header `Idempotency-Key`                       | `422 Error.OrderIdempotencyKeyRequired`  |

Sau mỗi request bị từ chối: `SELECT count(*) FROM "Order"` không đổi và `balance` không đổi.

### S3 — Hết hạn rồi mua lại (Story 1, AS4)

```sql
UPDATE "Entitlement" SET "startsAt" = now() - interval '40 day', "expiresAt" = now() - interval '1 day'
WHERE "customerId" = '<C1_ID>' AND "productId" = '<P_ACTIVE>';
```

Mua lại `$OFFER_SUB` → `200`; cùng một row Entitlement (`id` không đổi), `startsAt` = thời điểm mua
mới, `expiresAt` = 30 ngày **kể từ lúc mua**, không nối tiếp kỳ cũ. `SELECT count(*) FROM "Order"
WHERE "customerId" = '<C1_ID>'` tăng 1.

### S4 — Gói một lần, miễn phí và vĩnh viễn (Story 2)

Dùng `$C2` trên một Product khác hoặc reset trạng thái quyền của `$C2` trước:

1. `$OFFER_FREE` (giá 0) → `200`, `totalAmount="0"`, `balance` **không đổi**,
   `Entitlement."oneTimePurchasedAt"` khác null.
2. Nếu gói một lần có `durationDays = null` → `entitlement.expiresAt = null`.
3. Cho quyền hết hạn (SQL như S3) rồi mua `$OFFER_ONCE2` → `409 Error.OneTimeOfferAlreadyUsed`.
4. Cho quyền hết hạn rồi mua `$OFFER_SUB` → `200` (suất một lần không chặn gói thuê bao).
5. Sau các lần mua tiếp theo: `oneTimePurchasedAt` **giữ nguyên giá trị đầu tiên**.

### S5 — Quyền bị thu hồi chặn mua (FR-010, Edge Cases)

1. `POST $API/admin/entitlements/<entitlementId>/revoke` bằng `$ADMIN` với lý do bất kỳ.
2. Customer mua lại gói bất kỳ của Product đó → **`409 Error.EntitlementRevoked`**.
3. Kiểm tra log app: **không** có lỗi 500 hay lỗi constraint
   `Entitlement_revoke_fields_check` — đây chính là bẫy mà FR-010 chặn.
4. `POST $API/admin/entitlements/grant` cấp lại → sau đó mua vẫn bị chặn bằng
   `EntitlementStillActive` (vì quyền vừa cấp còn hiệu lực), không phải `EntitlementRevoked`.

### S6 — Chống bấm mua hai lần (Story 3)

```bash
K=$(KEY)
BODY="{\"productOfferId\":\"$OFFER_SUB\"}"
curl -sX POST $API/orders -H "Authorization: Bearer $C1" -H "Idempotency-Key: $K" \
  -H 'Content-Type: application/json' -d "$BODY"      # lần 1
curl -sX POST $API/orders -H "Authorization: Bearer $C1" -H "Idempotency-Key: $K" \
  -H 'Content-Type: application/json' -d "$BODY"      # lần 2 — cùng key, cùng gói
```

Kỳ vọng: cả hai `200` với **cùng `id` đơn hàng**, `balance` chỉ giảm một lần, `count(*)` trên
`"Order"` tăng đúng 1, và lần 2 có khối `entitlement` cùng shape với lần 1.

Tiếp theo với cùng `K`:

- Gửi `{"productOfferId":"$OFFER_ONCE2"}` → `409 Error.OrderIdempotencyKeyReused`.
- Gửi `K` viết **hoa** (`tr 'a-f' 'A-F'`) với cùng gói → vẫn trả lại đúng đơn cũ, **không** tạo đơn
  thứ hai (kiểm chứng quyết định R2: cột kiểu `UUID` chuẩn hoá chữ hoa/thường).

Thất bại rồi gửi lại cùng key:

1. Đặt `balance = 0` cho `$C2`, mua `$OFFER_SUB` với key `K2` → `409 InsufficientBalance`.
2. `UPDATE "Profile" SET balance = 100000 …` rồi gửi lại **đúng `K2`** → `200`, đơn được tạo
   (FR-024: lần thất bại không để lại dấu vết).

### S7 — Lịch sử mua hàng (Story 4)

1. `GET $API/orders/me` bằng `$C1` → phân trang, mới nhất trước, mỗi dòng có `item.offerSnapshot` và
   `item.product.name` hiện tại.
2. Publisher đổi giá gói (qua API Product Offer) rồi bỏ hẳn gói đó khỏi bảng giá; gọi lại
   `GET $API/orders/me` → **giá và thời lượng trong `offerSnapshot` không đổi**; `item.productOfferId`
   vẫn trỏ được tới gói đã xoá mềm.
3. `GET $API/orders/<id>` bằng `$C2` (đơn của `$C1`) → `404 Error.OrderNotFound`.
4. `GET $API/orders/<uuid ngẫu nhiên>` → `404 Error.OrderNotFound` (không phân biệt với case 3).
5. `GET $API/orders/me?limit=101` → `422`; `?limit=100` → `200`.
   `GET $API/orders/me` phải trả **danh sách**, không phải `422 Invalid UUID` — nếu nhận `422` thì
   `@Get(':orderId')` đang khai báo trước `@Get('me')` (research R10).
6. Sau khi Admin thu hồi quyền của `$C1`: `GET $API/orders/me` vẫn trả đủ đơn cũ.

### S8 — Phân quyền (FR-041)

- Gọi `POST $API/orders` **không** token → `401`.
- Trước khi gán permission cho role `CUSTOMER` (bước §1): customer gọi 3 route → `403`. Sau khi
  gán → hoạt động bình thường. (Kiểm tra một lần lúc deploy.)

## 3. Ràng buộc dữ liệu (data-model.md)

Chạy trực tiếp trên DB, mỗi lệnh phải **bị từ chối**:

```sql
-- trùng mã chống trùng của cùng customer
INSERT INTO "Order" ("customerId","productId","productOfferId","totalAmount","offerSnapshot","paidAt","idempotencyKey")
SELECT "customerId","productId","productOfferId",0,'{}'::jsonb,now(),"idempotencyKey" FROM "Order" LIMIT 1;
-- tổng tiền âm
UPDATE "Order" SET "totalAmount" = -1;
-- snapshot không phải object
UPDATE "Order" SET "offerSnapshot" = '[]'::jsonb;
-- FK: đơn trỏ tới Product/gói không tồn tại
UPDATE "Order" SET "productId" = gen_random_uuid();
UPDATE "Order" SET "productOfferId" = gen_random_uuid();
-- FK: quyền trỏ tới đơn không tồn tại
UPDATE "Entitlement" SET "latestOrderId" = gen_random_uuid();
```

Và kiểm tra FK đã tồn tại:

```sql
SELECT conname FROM pg_constraint WHERE conname = 'Entitlement_latestOrderId_fkey';
```

## 4. Đồng thời (SC-001, SC-002, SC-007)

**(a) Hai request cùng mã chống trùng** — gửi song song 5 request cùng `K` cho cùng gói:

```bash
K=$(KEY)
for i in $(seq 5); do
  curl -sX POST $API/orders -H "Authorization: Bearer $C1" -H "Idempotency-Key: $K" \
    -H 'Content-Type: application/json' -d "{\"productOfferId\":\"$OFFER_SUB\"}" &
done; wait
```

Kỳ vọng: tất cả `200` cùng một `id` (hoặc `503` nếu chờ khoá quá lâu), đúng **1** đơn trong DB,
`balance` giảm đúng **một lần**.

**(b) Hai request khác key, cùng customer, cùng Product**: đúng 1 request `200`, các request còn lại
`409 Error.EntitlementStillActive`, và `balance` chỉ giảm một lần.

**(c) Số dư chỉ đủ một đơn**: đặt `balance` = đúng giá một gói, gửi song song hai request mua hai
Product khác nhau → đúng 1 `200`, 1 `409 InsufficientBalance`,
`SELECT balance FROM "Profile"` ≥ 0.

**(d) Mua song song với nạp tiền**: trong lúc chạy (c), chạy đồng thời
`UPDATE "Profile" SET balance = balance + 50000 WHERE "userId" = '<C1_ID>'` →
số dư cuối cùng = số dư đầu + 50000 − tổng tiền các đơn `200` (không mất cập nhật).

## 5. Contract nội bộ (FR-008, FR-010, R8)

Kiểm chứng bằng unit test trong `src/routes/order/test/` và `src/routes/entitlement/test/`
(`npm test`):

- Service gọi `lockForPurchase` **sau** khi đã khoá Product → Offer → Profile, và chỉ gọi
  `activateFromOrder` khi quyền không `REVOKED` và không còn hiệu lực.
- `activateFromOrder` nhận đúng `offerType`, `durationDays`, `now` của transaction và `orderItemId`
  vừa tạo.
- `findSummaryForOrder` trả trạng thái hiển thị đúng cho ba trường hợp `ACTIVE`/`EXPIRED`/`REVOKED`.
- Replay dùng chung đường dựng response với lần mua đầu.

## 6. Cổng chất lượng

```bash
npm run lint && npm test && npm run build
```

Sau khi đổi `schema.prisma` phải chạy lại `npm run prisma:generate` trước `npm run build`, nếu không
build fail với `TS2694 ... has no exported member 'OrderSelect'`.
