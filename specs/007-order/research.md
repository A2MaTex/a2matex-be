# Research: 007-order

**Input**: [spec.md](./spec.md), [planning-notes.md](./planning-notes.md), code đang chạy trong
repo, và module `entitlement` của [006](../006-entitlement/) (đã triển khai + verify 2026-11-21).
Mỗi mục: Decision / Rationale / Alternatives considered. Những chỗ khác với `planning-notes.md`
được đánh dấu **(thay đổi so với planning-notes)**.

## R1. Không retry khi deadlock/serialization — **(thay đổi so với planning-notes)**

**Decision**: Không có vòng retry nào. Lỗi hết thời gian chờ transaction (`P2028`, bắt bằng
`isTransactionTimeoutPrismaError`) map thành `503 Error.OrderOperationTimeout`. Không bắt riêng lỗi
serialization/deadlock.

**Rationale**: `planning-notes` viết "retry có giới hạn như product-offer repository" — đọc lại code
thì **không có** cơ chế retry nào trong repo: `ProductOfferService.replace` chỉ map `P2028` thành
`503 ProductOfferReplaceTimeoutException`, và `src/shared/utils/prisma.ts` chỉ có 4 helper
(`P2002`, `P2025`, `P2003`, `P2028`) — không có helper cho `40001`/`40P01`. Transaction của repo
chạy ở isolation mặc định (Read Committed) với row lock tường minh nên không sinh lỗi
serialization; deadlock không xảy ra vì mọi luồng khoá theo cùng thứ tự (R4). Thêm vòng retry là
cơ chế mới cho nhu cầu chưa xảy ra (Constitution VI).

**Alternatives considered**: retry 2–3 lần với backoff — phải xử lý "retry một thao tác trừ tiền",
đúng loại rủi ro mà idempotency đang chống; nếu cần về sau thì client gửi lại cùng mã chống trùng là
đủ và an toàn hơn.

## R2. Mã chống trùng lưu kiểu `UUID`, không phải `VARCHAR` — **(thay đổi so với planning-notes)**

**Decision**: Cột `Order."idempotencyKey" UUID NOT NULL`, unique `(customerId, idempotencyKey)`.

**Rationale**: `Submission."idempotencyKey"` là `VARCHAR(255)`, nhưng `z.uuid()` **chấp nhận chữ
hoa** (đã kiểm chứng: `z.uuid().safeParse('3F2504E0-…')` → `true`). Với `VARCHAR`,
`3F2504E0-…` và `3f2504e0-…` là hai khoá khác nhau ⇒ cùng một lần bấm mua gửi lại với khác chữ hoa
sẽ tạo đơn thứ hai và trừ tiền hai lần. Kiểu `UUID` của PostgreSQL chuẩn hoá về chữ thường nên khử
hẳn lớp lỗi này. Đây là đường tiền, khác với Submission nên chấp nhận lệch convention.

**Alternatives considered**: giữ `VARCHAR(255)` cho giống Submission và `.toLowerCase()` ở
decorator — sửa decorator dùng chung sẽ ảnh hưởng Submission; kiểu dữ liệu đúng là nơi chặn tốt hơn
code tầng trên.

## R3. Trạng thái đơn hàng: enum chỉ có `PAID`

**Decision**: `enum OrderStatus { PAID }`, cột `status OrderStatus NOT NULL DEFAULT 'PAID'`, kèm
`paidAt TIMESTAMPTZ(6) NOT NULL`. Không có `PENDING`, `CANCELLED`, `FAILED`.

**Rationale**: FR-005 nói thất bại thì rollback, không để lại đơn — nên ba giá trị kia không bao giờ
được ghi. Giống 006 R3 (enum chỉ giữ giá trị thực sự được ghi, `EXPIRED` suy ra lúc đọc). Giữ cột
`status` (thay vì bỏ hẳn) vì spec Key Entities và FR-032 đều yêu cầu trạng thái trong dữ liệu trả
về, và vì hoàn tiền/huỷ đơn đã nằm trong "spec sau": thêm giá trị mới chỉ là
`ALTER TYPE "OrderStatus" ADD VALUE`. `paidAt NOT NULL` mạnh hơn CHECK
`status <> 'PAID' OR "paidAt" IS NOT NULL` trong `db_design/04`.

**Alternatives considered**: đủ 4 giá trị theo `db_design/04` — ba giá trị chết, không ai tạo ra
chúng; bỏ hẳn cột `status` và trả hằng `"PAID"` ở API — tiết kiệm một cột nhưng dữ liệu trong DB
không tự mô tả và lệch Key Entities của spec.

## R4. Thứ tự khoá và luồng một lần mua (FR-002, FR-003, FR-009)

**Decision** — tất cả trong **một** `@Transactional()`:

1. Đọc `ProductOffer` theo id **không khoá**, chỉ để lấy `productId`. Không có ⇒
   `404 ProductOfferNotFound`.
2. `SELECT id, status, (EXTRACT(EPOCH FROM now())*1000)::bigint AS "transactionNowMs" FROM "Product"
   WHERE id = $1 AND "deletedAt" IS NULL FOR UPDATE`. Không có ⇒ `404 ProductNotFound`;
   `status <> 'ACTIVE'` ⇒ `409 ProductNotPurchasable`.
3. Khoá lại chính Offer đó và **kiểm tra lại**: `FOR UPDATE` với
   `id = $1 AND "productId" = $2 AND "deletedAt" IS NULL`. Không có ⇒ `404 ProductOfferNotFound`
   (Publisher vừa thay bảng giá giữa bước 1 và bước 2). Giá/thời lượng dùng cho lần mua lấy từ đây.
4. Khoá `Profile` của customer: `SELECT p.id, p.balance FROM "Profile" p JOIN "User" u ON
   u.id = p."userId" WHERE p."userId" = $1 AND p."deletedAt" IS NULL AND u."deletedAt" IS NULL
   FOR UPDATE OF p`. Không có ⇒ `404 OrderCustomerProfileNotFound`.
5. **Tra mã chống trùng trong transaction** — tối ưu, không phải lớp bảo đảm (R5).
6. `EntitlementService.lockForPurchase` → áp quy tắc theo đúng thứ tự FR-003 (REVOKED → còn hiệu
   lực → suất một lần).
7. Kiểm tra số dư, trừ số dư (R6).
8. Tạo `Order` + `OrderItem` (nested create một câu).
9. `EntitlementService.activateFromOrder` với `orderItemId` vừa tạo.

`now` dùng chung toàn bộ là `transactionNow` lấy ở bước 2 (`now()` cố định trong suốt transaction
PostgreSQL), đúng FR-009 và pattern `product-offer.repo.ts` / `entitlement.repo.ts`.

**Rationale**: trùng thứ tự khoá chung `Product → ProductOffer → Profile → Entitlement` mà 006 R5 và
`ProductOfferService.replace` đang dùng ⇒ không có chu trình khoá, không deadlock. Bước 1 không khoá
vì client chỉ gửi `productOfferId` mà khoá phải bắt đầu từ `Product`; bước 3 kiểm tra lại là thứ
đóng cửa sổ race đó. Khoá `Profile` tuần tự hoá mọi lần mua của cùng customer — nhờ vậy bước 5 thấy
được đơn mà request song song vừa commit, và số dư không bị mất cập nhật.

**Alternatives considered**: khoá `Offer` trước rồi mới `Product` — đảo thứ tự so với Product Offer,
tạo nguy cơ deadlock thật; `SELECT … FOR SHARE` trên Product — `FOR SHARE` vẫn chặn được một
`FOR UPDATE` song song nên lifecycle không đổi `status` dưới chân lần mua, nhưng trộn hai chế độ
khoá trên cùng một row không đem lại lợi ích gì ở quy mô hiện tại, trong khi `FOR UPDATE` giữ đúng
chế độ khoá mà 006 R5 và `ProductOfferService.replace` đang dùng.

## R5. Idempotency: tra trước, tra lại khi thất bại, unique là chốt chặn cuối (FR-020–024)

**Decision**: đi theo đúng `SubmissionService.create`:

1. **Trước transaction**: tra `(customerId, idempotencyKey)`. Có ⇒ `resolveReplay`.
2. Chạy transaction mua.
3. **Khi transaction ném lỗi bất kỳ**: tra lại `(customerId, idempotencyKey)` một lần. Có ⇒
   `resolveReplay` (FR-023 — request song song vừa commit). Không có ⇒ ném tiếp: `HttpException` giữ
   nguyên, `P2028` ⇒ `503 OrderOperationTimeout`, `P2002` trên `(customerId, idempotencyKey)` ⇒ tra
   lại lần nữa rồi replay (nếu vẫn không thấy thì log error và ném lỗi gốc).

4. `resolveReplay(order)`: `order.item.productOfferId === body.productOfferId` ⇒ trả lại đơn đó;
   khác ⇒ `409 OrderIdempotencyKeyReused`.

**Hai lần tra khác nhau, đừng nhầm**: lần tra ở bước 5 của R4 (trong transaction, sau khi khoá
`Profile`) là **tối ưu** — nó biến "request thua chạy hết transaction rồi mới trượt ở
`EntitlementStillActive`" thành "thấy ngay đơn của request thắng và trả lại", tiết kiệm một
transaction vô ích. Lần tra ở bước 3 trên đây (trong `catch`, sau khi transaction đã ném lỗi) mới là
**lớp bảo đảm** FR-023 đòi hỏi: nó bắt mọi kiểu thua, kể cả thua ở quy tắc nghiệp vụ hay hết thời
gian chờ khoá. Phải có bước 3; bước 5 của R4 là tuỳ chọn nhưng nên có.

Không thêm cột `requestHash`: input của Order chỉ có đúng một trường (`productOfferId`) nên so trực
tiếp với `OrderItem."productOfferId"` là đủ (Submission cần hash vì input là một object nhiều
trường).

**Rationale**: pattern đã chạy trong repo, đã xử lý đúng ba tình huống (replay sau thành công, hai
request song song, key dùng lại cho input khác). Bước 5 của R4 (tra lần hai **sau** khi khoá
`Profile`) biến "hai request song song" thành "request sau chờ khoá rồi thấy đơn đã commit" thay vì
lỗi nghiệp vụ ngẫu nhiên.

**Alternatives considered**: chỉ dựa vào unique constraint rồi bắt `P2002` — khi thua, request sau
thường trượt ở quy tắc nghiệp vụ (quyền vừa có hiệu lực) **trước khi** chạm unique, nên sẽ trả
`EntitlementStillActive` thay vì đơn cũ, vi phạm FR-023.

## R6. Trừ số dư (FR-004)

**Decision**: đã khoá `Profile` ở bước 4 nên so sánh `balance >= priceAmount` trong service
(`409 InsufficientBalance`), sau đó trừ bằng câu có điều kiện:

```ts
prisma.profile.updateMany({
  where: { userId: customerId, deletedAt: null, balance: { gte: priceAmount } },
  data: { balance: { decrement: priceAmount } },
})
```

`count === 0` sau khi đã khoá và đã so sánh là **bất biến bị phá** ⇒ log `error` rồi ném lỗi gốc
(500), không âm thầm bỏ qua — giống cách 006 xử lý vi phạm unique `(customerId, productId)`.

**Rationale**: `updateMany` với điều kiện `gte` là cập nhật nguyên tử ngay trong câu lệnh, không
đọc-rồi-ghi; `topup.repo.ts` đã dùng `{ increment }` cho chiều cộng nên chiều trừ dùng `{ decrement }`
là đối xứng. Giá 0 vẫn chạy đúng câu này (trừ 0, luôn thành công) nên không cần nhánh riêng cho
acquisition miễn phí (FR-007).

**Alternatives considered**: `$executeRaw` với `UPDATE … WHERE balance >= $price` — cùng ngữ nghĩa
nhưng mất type-safety và không cần thiết; đọc balance rồi `update` giá trị tuyệt đối — mất cập nhật
khi có nạp tiền song song.

## R7. Chặn `REVOKED` trước khi kích hoạt quyền (FR-010)

**Decision**: thứ tự kiểm tra trong bước 6 của R4 là **REVOKED → còn hiệu lực → suất một lần**, đọc
từ kết quả `lockForPurchase` (`status`, `expiresAt`, `oneTimePurchasedAt`). Chỉ khi cả ba qua mới
gọi `activateFromOrder`.

- Còn hiệu lực = `expiresAt === null || expiresAt > transactionNow` (so với `now()` của transaction,
  không nhìn cột `status` để suy ra hết hạn).
- Suất một lần = `oneTimePurchasedAt !== null` và Offer là `ONE_TIME` ⇒ chặn.

**Rationale**: `EntitlementRepo.upsertFromOrder` cố ý **không** xoá `revokedAt/revokedById/
revokedReason`; gọi `activateFromOrder` trên quyền `REVOKED` sẽ đặt `status='ACTIVE'` mà vẫn còn
revoke fields ⇒ `Entitlement_revoke_fields_check` chặn ⇒ transaction abort ⇒ 500. Điều này đã được
kiểm chứng bằng SQL mô phỏng trong transaction rollback ngày 2026-11-21 (ghi trong
`specs/006-entitlement/tasks.md`). Contract không cần đổi: `lockForPurchase` đã trả `status`.

**Alternatives considered**: để `activateFromOrder` tự xoá revoke fields — phá quyết định của spec
006 (thu hồi chỉ Admin gỡ được) và biến một quy tắc kiểm duyệt thành lỗi im lặng.

## R8. Dữ liệu trả về cho lần mua và cho replay (FR-022, FR-032)

**Decision**: thêm **một** method đọc vào `EntitlementService` (module 006):
`findSummaryForOrder({ customerId, productId })` → `{ id, status (hiển thị), startsAt, expiresAt }
| null`. Cả đường mua thành công lẫn đường replay đều dùng method này để dựng khối `entitlement`
trong response ⇒ một shape duy nhất cho cả hai (FR-022).

**Rationale**: replay phải trả **đúng shape** với lần đầu; dựng lại từ `offerSnapshot` của đơn cũ sẽ
sai nếu Admin đã thu hồi/cấp lại sau đó. Order không đọc thẳng bảng `Entitlement` vì mỗi module sở
hữu bảng của mình (convention hiện tại). Một truy vấn theo unique `(customerId, productId)` là rẻ.

**Alternatives considered**: replay chỉ trả Order (không có `entitlement`) — lệch shape, FR-022 cấm;
dùng `checkUsage` — trả `usable/reason`, không có `startsAt`/`expiresAt`.

## R9. Bảng `"Order"` là từ khoá SQL

**Decision**: mọi thao tác trên `Order`/`OrderItem` dùng Prisma Client API (`prisma.order.*`), không
dùng `$queryRaw`. Raw SQL chỉ dùng cho ba câu khoá (`Product`, `ProductOffer`, `Profile`) vì Prisma
không có `FOR UPDATE`. Trong migration viết tay, tên bảng luôn đặt trong nháy kép `"Order"`.

**Rationale**: `ORDER` là từ khoá dành riêng của SQL; quên nháy kép là lỗi cú pháp khó đọc. Prisma
tự trích dẫn định danh nên dùng Client API là an toàn nhất, và các truy vấn Order không cần khoá
hàng nên không mất gì.

## R10. Permission và route (FR-041, Constitution II)

**Decision**:

| Method | Path               | Permission gán cho |
| ------ | ------------------ | ------------------ |
| POST   | `/orders`          | `CUSTOMER`         |
| GET    | `/orders/me`       | `CUSTOMER`         |
| GET    | `/orders/:orderId` | `CUSTOMER`         |

`@Get('me')` **phải** khai báo trước `@Get(':orderId')` trong controller: NestJS khớp route theo thứ
tự khai báo, đặt ngược lại thì `/orders/me` rơi vào route param và trả `422 Invalid UUID` thay vì
danh sách. 006 không gặp bẫy này vì route `me` nằm một mình trên controller riêng.

- `seed:permissions` quét ba route và gán cho `ADMIN` (hành vi của script), sau đó **bước vận hành
  bắt buộc**: gán cả ba cho role `CUSTOMER` qua `PUT /roles/:id/permissions` với danh sách cũ **+**
  ba id mới (API thay toàn bộ tập).
- Không dùng scope `OWN`: cả ba route chỉ đọc/ghi theo `userId` của token, không có tham số trỏ tới
  dữ liệu người khác (006 R6).
- `GET /orders/:orderId` lọc `customerId = token.userId` ngay trong câu truy vấn ⇒ đơn người khác
  trả `404`, không phân biệt được với đơn không tồn tại (FR-031).

**Rationale**: giống hệt cách `GET /entitlements/me` đã làm ở 006 (T035/T036) — đã chạy thật và ghi
trong `specs/006-entitlement/tasks.md`.

## R11. Biểu diễn số tiền (FR-033)

**Decision**: `BIGINT` trong DB; Zod output dùng `zBigIntAsString()` (`src/shared/utils/zod.ts`) nên
API trả decimal string (`"50000"`). `offerSnapshot.priceAmount` cũng là string trong JSON. Input
không có trường tiền nào (FR-001).

**Rationale**: `PRODUCT_OFFER_MAX_PRICE_AMOUNT` cho phép tới 19 chữ số, vượt
`Number.MAX_SAFE_INTEGER`; `BigInt` không sống sót `JSON.stringify`. Đây đúng pattern
`product-offer.model.ts` đang dùng.

## R12. Snapshot điều khoản thương mại (FR-006)

**Decision**: `OrderItem."offerSnapshot" JSONB NOT NULL`, có version:

```json
{ "schemaVersion": "1.0", "offerType": "SUBSCRIPTION", "priceAmount": "50000", "durationDays": 30 }
```

Hằng `ORDER_OFFER_SNAPSHOT_SCHEMA_VERSION = '1.0'` trong `src/shared/constants/order.constant.ts`;
CHECK `jsonb_typeof("offerSnapshot") = 'object'` ở DB (giống `Entitlement."grantSnapshot"`).
`offerType` là tên field trong snapshot; cột gốc của bảng `ProductOffer` tên là `type`.

**Rationale**: lịch sử phải bất biến kể cả khi Publisher sửa giá hoặc bỏ gói (FR-006, SC-005);
`priceAmount` để string cho đồng nhất với API; có `schemaVersion` để đọc được khi shape đổi.

## R13. Đọc lịch sử (FR-030–032)

**Decision**:
- `GET /orders/me`: phân trang `page`/`limit` (`limit ≤ 100`, hằng `ORDER_PAGE_SIZE_MAX`), sắp xếp
  `createdAt DESC, id ASC`; mỗi dòng gồm đơn + dòng hàng + Product (`id`, `name`, `slug`,
  `status` hiện tại).
- `GET /orders/:orderId`: cùng shape dòng, thêm gì cũng không cần vì MVP mỗi đơn một dòng hàng.
- Không trả khối `entitlement` ở hai route đọc (đó là việc của My Products — 006 US2).

**Rationale**: cap 100 giống `ENTITLEMENT_PAGE_SIZE_MAX`; `id ASC` làm tie-break để phân trang ổn
định khi hai đơn cùng `createdAt`. Tên Product lấy hiện tại theo Assumption của spec, chỉ điều khoản
thương mại mới snapshot.

## R14. Khoá ngoại `Entitlement.latestOrderItemId` (FR-040)

**Decision**: migration của 007 thêm
`ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_latestOrderItemId_fkey"
FOREIGN KEY ("latestOrderItemId") REFERENCES "OrderItem"(id) ON DELETE NO ACTION ON UPDATE NO ACTION;`
và `schema.prisma` đổi `latestOrderItemId` thành relation thật tới `OrderItem`.

**Rationale**: 006 R8 cố ý để cột không FK vì `OrderItem` chưa tồn tại; đây là migration đầu tiên có
thể đóng lại. Dữ liệu hiện tại của cột luôn `NULL` (006 không ghi vào) nên thêm FK không cần backfill
và không fail trên DB đang chạy.

**Alternatives considered**: để mãi không FK — mất toàn vẹn tham chiếu cho chính cột nối hai feature.

## R15. Kiểm thử

**Decision**: Vitest unit test co-located `src/routes/order/test/order.service.spec.ts` và
`order.controller.spec.ts`, mock `OrderRepo` + `EntitlementService` + `TransactionService`
(`runInTransaction` gọi thẳng callback), đúng cách `entitlement.service.spec.ts` đang làm. Hành vi
ràng buộc DB, khoá và đồng thời kiểm chứng thủ công theo [quickstart.md](./quickstart.md), chạy API
từ `dist` (`npm run start:prod`) vì `start:dev` (`tsx`) không emit decorator metadata nên DTO không
được validate.

**Rationale**: repo chưa có hạ tầng test DB tự động; giữ đúng quy ước hiện tại (Constitution VI).
Bẫy `start:dev` đã gặp thật khi verify 006.
