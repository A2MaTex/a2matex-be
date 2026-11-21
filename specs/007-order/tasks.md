---

description: "Task list for 007-order"
---

# Tasks: Order — customer mua quyền dùng Product bằng số dư

**Input**: Design documents from `/specs/007-order/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/order-api.md](./contracts/order-api.md),
[quickstart.md](./quickstart.md)

**Tests**: spec không yêu cầu TDD, nhưng plan/research R15 chốt unit test Vitest co-located ở
`src/routes/order/test/` cho service và controller — mỗi story có task test, viết sau phần triển
khai của story đó. Ràng buộc DB, khoá và đồng thời kiểm chứng thủ công theo quickstart (Phase 8).

**Organization**: Tasks nhóm theo user story của spec. `planning-notes.md` chỉ là đầu vào lịch sử —
khi mâu thuẫn, theo research/data-model/contracts (đặc biệt R1 và R2 đã đảo hai điểm của nó).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác file, không phụ thuộc task chưa xong)
- **[Story]**: US1–US4 theo spec.md

## Quy ước chung cho mọi task

- Import TypeScript dùng đuôi `.ts` (ESM, `tsx`), inject bằng `@Inject(Class)` như các module hiện
  có.
- Repo luôn lấy client qua `this.prismaService.getClient()` để tự tham gia transaction của caller;
  method ghi của service bọc `@Transactional()` và class inject `TransactionService` với tên field
  `transactionService`.
- Bảng `"Order"` là **từ khoá SQL**: dùng Prisma Client API (`prisma.order.*`) cho mọi thao tác
  Order/OrderItem; raw SQL chỉ dùng cho 3 câu khoá (`Product`, `ProductOffer`, `Profile`) vì Prisma
  không có `FOR UPDATE`. Trong migration viết tay luôn đặt tên bảng trong nháy kép (research R9).
- Mọi so sánh thời gian dùng `transactionNow` lấy từ câu khoá `Product`
  (`(EXTRACT(EPOCH FROM now()) * 1000)::bigint AS "transactionNowMs"` rồi `new Date(Number(...))`),
  theo `src/routes/entitlement/entitlement.repo.ts` (FR-009, R4).
- Exception khai báo dạng hằng trong `order.error.ts`, theo `entitlement.error.ts`.
- Tiền trong DB là `BIGINT`, ra API là decimal string qua `zBigIntAsString()` (R11).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: hằng số và entity model dùng chung cho cả module.

- [X] T001 [P] Tạo `src/shared/constants/order.constant.ts` export: `OrderStatus = { PAID }` (chỉ 1 giá trị — research R3); `ORDER_OFFER_SNAPSHOT_SCHEMA_VERSION = '1.0'`; `ORDER_PAGE_SIZE_MAX = 100`; kèm type `OrderStatusValue` theo mẫu `src/shared/constants/entitlement.constant.ts`
- [X] T002 [P] Tạo `src/entities/order.model.ts`: Zod mirror của model `Order` và `OrderItem` theo bảng cột trong data-model.md (`z.uuid()`, `z.date()`, `z.bigint()` cho `totalAmount`/`unitPriceAmount`, `.nullable()` đúng cột nullable; `status` là enum 1 giá trị `PAID`; `offerSnapshot` object), theo mẫu `src/entities/entitlement.model.ts` (phụ thuộc T001)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: schema DB, migration, khung module và phần repo/model dùng chung cho mọi story.

**⚠️ CRITICAL**: không story nào bắt đầu trước khi phase này xong.

- [X] T003 Sửa `prisma/schema.prisma`: thêm `enum OrderStatus { PAID }`; `model Order` với cột `id`, `customerId`, `status @default(PAID)`, `totalAmount BigInt`, `paidAt DateTime @db.Timestamptz(6)` **NOT NULL**, `idempotencyKey String @db.Uuid` (R2 — kiểu UUID, **không** phải VarChar), `createdAt @default(now())`, `@@unique([customerId, idempotencyKey])`, `@@index([customerId, createdAt(sort: Desc)])`; `model OrderItem` với `orderId`, `productId`, `productOfferId`, `unitPriceAmount BigInt`, `offerSnapshot Json`, `createdAt`, `@@unique([orderId, productId])`, `@@index([orderId])`, `@@index([productId])`; đổi `Entitlement.latestOrderItemId` từ cột trần thành relation tới `OrderItem` và thêm back-relation `OrderItem.Entitlement Entitlement[]`; thêm back-relation trên `User` (`Order[]`), `Product` (`OrderItem[]`), `ProductOffer` (`OrderItem[]`); thêm comment `/// This table contains check constraints...` cho cả hai model mới. **Không** thêm `updatedAt`/`deletedAt`/`createdById` (đơn hàng bất biến — data-model.md)
- [X] T004 Tạo migration bằng `npm run prisma:migrate:create -- --name add_order`, rồi viết tay `prisma/migrations/<timestamp>_add_order/migration.sql` theo data-model.md: header comment mô tả quyết định (theo mẫu `20261121090000_add_entitlement/migration.sql`); `CREATE TYPE "OrderStatus" AS ENUM ('PAID')`; `CREATE TABLE "Order"` với FK `ON DELETE NO ACTION ON UPDATE NO ACTION`, `CONSTRAINT "Order_customerId_idempotencyKey_key" UNIQUE ("customerId", "idempotencyKey")`, `CONSTRAINT "Order_totalAmount_check" CHECK ("totalAmount" >= 0)`, `CREATE INDEX "Order_customerId_createdAt_idx" ON "Order" ("customerId", "createdAt" DESC)`; `CREATE TABLE "OrderItem"` với `CONSTRAINT "OrderItem_orderId_productId_key" UNIQUE ("orderId", "productId")`, `CONSTRAINT "OrderItem_unitPriceAmount_check" CHECK ("unitPriceAmount" >= 0)`, `CONSTRAINT "OrderItem_offerSnapshot_object_check" CHECK (jsonb_typeof("offerSnapshot") = 'object')`, hai index `OrderItem_orderId_idx` / `OrderItem_productId_idx`; cuối cùng `ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_latestOrderItemId_fkey" FOREIGN KEY ("latestOrderItemId") REFERENCES "OrderItem" (id) ON DELETE NO ACTION ON UPDATE NO ACTION` (FR-040, R14). Apply bằng `npm run prisma:migrate:deploy` trên **DB rỗng** rồi `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --config prisma7.config.ts` phải trả "No difference detected" (Constitution III) (phụ thuộc T003)
- [X] T005 Chạy `npm run prisma:generate` và xác nhận `src/generated/prisma` có model `Order`, `OrderItem`; chạy `npm run build` để chắc chắn không còn lỗi `TS2694` (phụ thuộc T004)
- [X] T006 [P] Tạo `src/routes/order/order.error.ts` với đúng 10 exception của contract §4: `OrderIdempotencyKeyReusedException = new ConflictException('Error.OrderIdempotencyKeyReused')`, `ProductOfferNotFoundException = new NotFoundException('Error.ProductOfferNotFound')`, `ProductNotPurchasableException = new ConflictException('Error.ProductNotPurchasable')`, `OrderCustomerProfileNotFoundException = new NotFoundException('Error.OrderCustomerProfileNotFound')`, `EntitlementRevokedException = new ConflictException('Error.EntitlementRevoked')`, `EntitlementStillActiveException = new ConflictException('Error.EntitlementStillActive')`, `OneTimeOfferAlreadyUsedException = new ConflictException('Error.OneTimeOfferAlreadyUsed')`, `InsufficientBalanceException = new ConflictException('Error.InsufficientBalance')`, `OrderNotFoundException = new NotFoundException('Error.OrderNotFound')`, `OrderOperationTimeoutException = new ServiceUnavailableException('Error.OrderOperationTimeout')`; dùng lại `ProductNotFoundException` từ `src/routes/product/product.error.ts` (không tạo mới)
- [X] T007 [P] Tạo `src/routes/order/order.model.ts` phần dùng chung: `OfferSnapshotSchema` (`schemaVersion: z.literal('1.0')`, `offerType` enum `ONE_TIME|SUBSCRIPTION`, `priceAmount: z.string()`, `durationDays: z.number().int().positive().nullable()`); `OrderOutput` đúng shape trong contracts/order-api.md (tiền dùng `zBigIntAsString()`, thời gian dùng `zDate()`, `item.product` gồm `id`, `name` nullable, `slug` nullable, `status`); `OrderIdParam` (`orderId: z.uuid()`, `.strict()`); `OrderPagination` = `page` default 1, `limit` default 10 `.max(ORDER_PAGE_SIZE_MAX)` (phụ thuộc T001)
- [X] T008 Tạo `src/routes/order/order.repo.ts` khung `@Injectable() OrderRepo` inject `PrismaService` với getter `prisma` → `getClient()`; thêm hàm private chuẩn hoá row raw → kiểu TS (BigInt/Date/JSON) và hằng `orderSelect` dùng chung cho mọi truy vấn đọc. **Lưu ý tên quan hệ**: ở Prisma quan hệ là `Order.OrderItem OrderItem[]` (danh sách, theo convention repo như `Product.ProductOffer`), nên select key là `OrderItem` chứ không phải `item`; `item` là tên field của **API** (contracts §0). `toOrderOutput` map `OrderItem[0]` → `item` — MVP đảm bảo đúng một dòng hàng (phụ thuộc T005, T007)
- [X] T009 Tạo `src/routes/order/order.service.ts` khung `OrderService` inject `OrderRepo`, `EntitlementService`, `TransactionService` (field `transactionService`), `Logger`; thêm helper private `toOrderOutput(row)` map row → `OrderOutput` (BigInt → string, Date → ISO string, parse `offerSnapshot` bằng `OfferSnapshotSchema`) (phụ thuộc T008)
- [X] T010 Tạo `src/routes/order/order.module.ts` (`imports: [EntitlementModule]`, `providers: [OrderService, OrderRepo]`, controller điền ở US1; comment: EntitlementModule không bao giờ import ngược lại) và đăng ký `OrderModule` trong `imports` của `src/app.module.ts` (phụ thuộc T009)

**Checkpoint**: migration đã apply, app khởi động được với module rỗng.

---

## Phase 3: User Story 1 - Mua gói thuê bao bằng số dư (Priority: P1) 🎯 MVP

**Goal**: customer mua được gói thuê bao bằng số dư; tiền, đơn hàng và quyền dùng thành công hoặc
thất bại cùng nhau; mọi lý do từ chối đúng thứ tự FR-003.

**Independent Test**: quickstart S1–S3: customer số dư 100.000 mua gói 30 ngày giá 50.000 → `200`,
số dư còn 50.000, `entitlement.status=ACTIVE` hết hạn sau 30 ngày; các case từ chối của S2 trả đúng
mã lỗi và không đổi dữ liệu.

### Implementation for User Story 1

- [X] T011 [US1] Thêm vào `src/routes/order/order.model.ts`: `CreateOrderInput` strict chỉ gồm `productOfferId: z.uuid()` (FR-001 — **không** nhận giá/thời lượng/loại gói/productId); `CreateOrderOutput` = `OrderOutput` cộng khối `entitlement: { id, status: 'ACTIVE'|'EXPIRED'|'REVOKED', startsAt, expiresAt nullable }` theo contracts §1
- [X] T012 [P] [US1] Tạo `src/routes/order/order.dto.ts` với `CreateOrderInputDTO`, `CreateOrderOutputDTO`, `OrderOutputDTO`, `OrderIdParamDTO` bằng `createZodDto` (phụ thuộc T011)
- [X] T013 [US1] Thêm vào `src/routes/order/order.repo.ts` các method khoá theo đúng thứ tự research R4: `findOfferProductId(productOfferId)` — đọc **không khoá** chỉ để lấy `productId` (`deletedAt IS NULL`); `lockProduct(productId)` → `SELECT id, status, (EXTRACT(EPOCH FROM now())*1000)::bigint AS "transactionNowMs" FROM "Product" WHERE id = $1 AND "deletedAt" IS NULL FOR UPDATE`; `lockOfferForUpdate(productOfferId, productId)` → `SELECT id, type, "priceAmount", "durationDays" FROM "ProductOffer" WHERE id = $1 AND "productId" = $2 AND "deletedAt" IS NULL FOR UPDATE` (kiểm tra lại vì Publisher có thể vừa thay bảng giá); `lockCustomerProfile(customerId)` → `SELECT p.id, p.balance FROM "Profile" p JOIN "User" u ON u.id = p."userId" WHERE p."userId" = $1 AND p."deletedAt" IS NULL AND u."deletedAt" IS NULL FOR UPDATE OF p`
- [X] T014 [US1] Thêm vào `src/routes/order/order.repo.ts` các method ghi: `debitBalance({ customerId, amount })` → `prisma.profile.updateMany({ where: { userId, deletedAt: null, balance: { gte: amount } }, data: { balance: { decrement: amount } } })` trả `count` (R6); `createOrderWithItem({ customerId, idempotencyKey, paidAt, totalAmount, productId, productOfferId, unitPriceAmount, offerSnapshot })` → một `prisma.order.create` có nested create `OrderItem`, select `{ id, paidAt, createdAt, item: { id } }` (phụ thuộc T013)
- [X] T015 [US1] Thêm vào `src/routes/order/order.repo.ts`: `findOrderForCustomer({ orderId, customerId })` dùng `orderSelect` (join `OrderItem` → `Product` lấy `id`, `name`, `slug`, `status` hiện tại) — dùng cho cả response tạo đơn lẫn route chi tiết của US4
- [X] T016 [US1] Thêm `findSummaryForOrder({ customerId, productId })` vào module entitlement (research R8): truy vấn theo unique `(customerId, productId)` trong `src/routes/entitlement/entitlement.repo.ts`, method public trong `src/routes/entitlement/entitlement.service.ts` trả `{ id, status (hiển thị, tính bằng `toEffectiveStatus` với `now()` của DB), startsAt, expiresAt } | null`, kiểu khai báo trong `src/routes/entitlement/entitlement.model.ts`. Không khoá, không ghi
- [X] T017 [US1] Thêm `create({ data, idempotencyKey, customerId })` vào `src/routes/order/order.service.ts`: method public bọc try/catch, gọi private `@Transactional() createInTransaction`. Thứ tự trong transaction đúng research R4: `findOfferProductId` → null ⇒ `ProductOfferNotFoundException`; `lockProduct` → null ⇒ `ProductNotFoundException`, `status !== 'ACTIVE'` ⇒ `ProductNotPurchasableException`; `lockOfferForUpdate` → null ⇒ `ProductOfferNotFoundException`; `lockCustomerProfile` → null ⇒ `OrderCustomerProfileNotFoundException`; `entitlementService.lockForPurchase` → `status === 'REVOKED'` ⇒ `EntitlementRevokedException` (**phải kiểm tra trước** — FR-010), `expiresAt === null || expiresAt > transactionNow` ⇒ `EntitlementStillActiveException`; `balance < priceAmount` ⇒ `InsufficientBalanceException`; `debitBalance` (count 0 sau khi đã khoá ⇒ log `error` và ném lỗi bất biến); `createOrderWithItem` với `offerSnapshot = { schemaVersion: ORDER_OFFER_SNAPSHOT_SCHEMA_VERSION, offerType: offer.type, priceAmount: offer.priceAmount.toString(), durationDays: offer.durationDays }`; `entitlementService.activateFromOrder({ ..., orderItemId, offerType: offer.type, durationDays: offer.durationDays, now: transactionNow })`; trả `toOrderOutput(await repo.findOrderForCustomer(...))` cộng khối `entitlement` từ `findSummaryForOrder`. Catch `isTransactionTimeoutPrismaError` ⇒ `OrderOperationTimeoutException`. Log `Order created orderId=… customerId=… productId=… productOfferId=… totalAmount=…` (phụ thuộc T014, T015, T016)
- [X] T018 [US1] Tạo `src/routes/order/order.controller.ts`: `@ApiTags('Orders')`, `@ApiBearerAuth('access-token')`, `@Controller('orders')`; route `@Post() @HttpCode(200) @ZodResponse({ type: CreateOrderOutputDTO })` nhận `@Body() CreateOrderInputDTO`, `@IdempotencyKey('Error.OrderIdempotencyKeyRequired') idempotencyKey`, `@ActiveUser('userId') customerId`, kèm `@ApiHeader({ name: IDEMPOTENCY_KEY_HEADER, required: true, description: 'UUID' })` theo mẫu `src/routes/submission/submission.controller.ts`; đăng ký controller trong `order.module.ts`
- [X] T019 [P] [US1] Viết `src/routes/order/test/order.service.spec.ts` (mock `OrderRepo`, `EntitlementService`, `TransactionService.runInTransaction` gọi thẳng callback): mua thành công gói thuê bao (kiểm tra tham số `createOrderWithItem` và `activateFromOrder`, đặc biệt `durationDays` và `now`); thứ tự gọi khoá `findOfferProductId → lockProduct → lockOfferForUpdate → lockCustomerProfile → lockForPurchase`; Offer null ⇒ `ProductOfferNotFoundException`; Offer bị đổi Product giữa chừng (lock trả null) ⇒ `ProductOfferNotFoundException`; Product null ⇒ `ProductNotFoundException`; Product `DRAFT`/`ARCHIVED`/`SUSPENDED` ⇒ `ProductNotPurchasableException`; Profile null ⇒ `OrderCustomerProfileNotFoundException`; quyền `REVOKED` ⇒ `EntitlementRevokedException` và **không** gọi `activateFromOrder`; quyền còn hạn và quyền vĩnh viễn ⇒ `EntitlementStillActiveException`; quyền đã hết hạn ⇒ mua được; `balance < price` ⇒ `InsufficientBalanceException` và không gọi `createOrderWithItem`; `debitBalance` trả `count = 0` ⇒ log error + ném lỗi; timeout ⇒ `OrderOperationTimeoutException`

**Checkpoint**: S1–S3 của quickstart chạy được sau khi seed permission (T031, T032).

---

## Phase 4: User Story 2 - Nhận gói một lần, miễn phí hoặc trả tiền (Priority: P1)

**Goal**: gói một lần đi đúng luồng mua, kể cả giá 0 và vĩnh viễn; mỗi customer chỉ một suất cho
mỗi Product.

**Independent Test**: quickstart S4: nhận gói một lần giá 0 → `200`, `totalAmount="0"`, số dư không
đổi, `oneTimePurchasedAt` được set; sau khi hết hạn, nhận gói một lần khác của cùng Product bị từ
chối nhưng mua gói thuê bao vẫn được.

### Implementation for User Story 2

- [X] T020 [US2] Bổ sung quy tắc gói một lần vào `createInTransaction` trong `src/routes/order/order.service.ts`: sau bước kiểm tra "quyền còn hiệu lực", nếu `offer.type === ProductOfferType.ONE_TIME` và `entitlement?.oneTimePurchasedAt !== null` ⇒ `OneTimeOfferAlreadyUsedException` (FR-011 — tính theo cặp customer–Product, không theo id gói); giá 0 **không** có nhánh riêng: vẫn gọi `debitBalance` với `amount = 0` và vẫn tạo Order/OrderItem (FR-007, R6)
- [X] T021 [P] [US2] Thêm test vào `src/routes/order/test/order.service.spec.ts`: gói `ONE_TIME` giá 0 ⇒ `totalAmount = 0n`, `debitBalance` vẫn được gọi, `activateFromOrder` nhận `offerType: 'ONE_TIME'`; gói `ONE_TIME` `durationDays = null` ⇒ truyền `durationDays: null` (quyền vĩnh viễn); `oneTimePurchasedAt` khác null + gói `ONE_TIME` ⇒ `OneTimeOfferAlreadyUsedException`; `oneTimePurchasedAt` khác null + gói `SUBSCRIPTION` ⇒ mua được; quyền chưa từng có ⇒ `oneTimePurchasedAt` không chặn

**Checkpoint**: US1 + US2 = toàn bộ đường mua (trả tiền và miễn phí).

---

## Phase 5: User Story 3 - Bấm mua hai lần không bị trừ tiền hai lần (Priority: P1)

**Goal**: cùng một mã chống trùng chỉ sinh một đơn; gửi lại trả đúng đơn cũ; dùng key cho gói khác
bị từ chối; lần thất bại không để lại dấu vết.

**Independent Test**: quickstart S6: hai request cùng key cùng gói → cùng `id` đơn, số dư giảm một
lần; cùng key khác gói → `409`; thất bại vì thiếu số dư rồi nạp tiền gửi lại cùng key → `200`.

### Implementation for User Story 3

- [X] T022 [US3] Thêm `findByIdempotencyKey({ customerId, idempotencyKey })` vào `src/routes/order/order.repo.ts`: truy vấn theo unique `(customerId, idempotencyKey)`, select đủ `orderSelect` để dựng response **và** `item.productOfferId` để so sánh replay (phụ thuộc T015)
- [X] T023 [US3] Thêm luồng idempotency vào `src/routes/order/order.service.ts` theo research R5: (1) trước transaction tra `findByIdempotencyKey` → có ⇒ `resolveReplay`; (2) trong transaction, sau khi khoá `Profile`, tra lại một lần (tối ưu, trả đơn của request thắng thay vì chạy tiếp); (3) trong `catch` của `create`, tra lại một lần nữa — có ⇒ `resolveReplay` (FR-023), không ⇒ `HttpException` ném nguyên, `P2028` ⇒ `OrderOperationTimeoutException`, `isUniqueConstraintPrismaError` trên `(customerId, idempotencyKey)` ⇒ tra lại rồi replay, nếu vẫn không thấy thì log `error` và ném lỗi gốc. `resolveReplay(order)`: `order.item.productOfferId === data.productOfferId` ⇒ trả `toOrderOutput(order)` cộng khối `entitlement` từ `findSummaryForOrder` (cùng shape với lần mua đầu — FR-022); khác ⇒ log `warn` + `OrderIdempotencyKeyReusedException`. Không thêm cột `requestHash` (phụ thuộc T022)
- [X] T024 [P] [US3] Thêm test vào `src/routes/order/test/order.service.spec.ts`: key đã có đơn cùng gói ⇒ trả đơn cũ, **không** gọi `debitBalance`/`createOrderWithItem`; key đã có đơn khác gói ⇒ `OrderIdempotencyKeyReusedException`; transaction ném `EntitlementStillActiveException` nhưng probe tìm thấy đơn ⇒ trả đơn đó thay vì lỗi; transaction ném lỗi và probe không thấy gì ⇒ ném đúng lỗi gốc; `P2002` ⇒ probe rồi replay; replay dựng khối `entitlement` bằng `findSummaryForOrder` (không dựng lại từ `offerSnapshot`)

**Checkpoint**: US1–US3 = MVP đầy đủ của đường mua.

---

## Phase 6: User Story 4 - Xem lịch sử mua hàng (Priority: P2)

**Goal**: customer xem được danh sách và chi tiết đơn của chính mình, với điều khoản đúng như lúc
mua.

**Independent Test**: quickstart S7: danh sách phân trang mới nhất trước; sau khi Publisher đổi giá
và bỏ gói, `offerSnapshot` không đổi; đơn của người khác trả `404`.

### Implementation for User Story 4

- [X] T025 [US4] Thêm vào `src/routes/order/order.model.ts`: `GetMyOrdersInput = OrderPagination.strict()`; `GetMyOrdersOutput = { items: OrderOutput[], totalItems, page, pageSize, totalPages }` theo mẫu `src/routes/entitlement/entitlement.model.ts`; thêm `GetMyOrdersInputDTO`, `GetMyOrdersOutputDTO` vào `src/routes/order/order.dto.ts`
- [X] T026 [US4] Thêm `listMine({ customerId, skip, take })` + `countMine(customerId)` vào `src/routes/order/order.repo.ts` dùng `orderSelect`, `orderBy: [{ createdAt: 'desc' }, { id: 'asc' }]` (R13), đi theo index `("customerId", "createdAt" DESC)` (phụ thuộc T015)
- [X] T027 [US4] Thêm `listMine({ customerId, query })` và `findOne({ orderId, customerId })` vào `src/routes/order/order.service.ts`: `listMine` dùng `getPagination(query)` từ `src/shared/utils/pagination.ts`, trả `totalPages = Math.ceil(totalItems / pageSize)`; `findOne` gọi `findOrderForCustomer` và ném `OrderNotFoundException` khi null (đơn của người khác và đơn không tồn tại cho cùng kết quả — FR-031) (phụ thuộc T026)
- [X] T028 [US4] Thêm hai route vào `src/routes/order/order.controller.ts`: `@Get('me') @ZodResponse({ type: GetMyOrdersOutputDTO })` nhận `@Query() GetMyOrdersInputDTO` + `@ActiveUser('userId')`, rồi `@Get(':orderId') @ZodResponse({ type: OrderOutputDTO })` nhận `@Param() OrderIdParamDTO` + `@ActiveUser('userId')`. **`@Get('me')` phải khai báo TRƯỚC `@Get(':orderId')`** — NestJS khớp theo thứ tự khai báo, đặt ngược lại thì `/orders/me` rơi vào route param và trả `422 Invalid UUID` (research R10)
- [X] T029 [P] [US4] Viết `src/routes/order/test/order.controller.spec.ts`: controller chuyển đúng `userId` từ token và `idempotencyKey` vào service cho cả ba route; và thêm vào `order.service.spec.ts` case `listMine` tính `totalPages` đúng, case `findOne` trả `OrderNotFoundException` khi repo trả null

**Checkpoint**: đủ 4 story.

---

## Phase 7: Entitlement contract regression

**Purpose**: đảm bảo phần thêm vào module 006 không làm hỏng 006 và đúng hợp đồng 007 cần. Không có
story label vì task này nằm trong module của spec 006, không thuộc user story nào của spec này.

- [X] T030 [P] Thêm test cho `findSummaryForOrder` vào `src/routes/entitlement/test/entitlement.service.spec.ts`: trả `null` khi chưa có quyền; trạng thái hiển thị đúng cho ba trường hợp `ACTIVE` / `EXPIRED` (quá hạn nhưng cột `status` vẫn `ACTIVE`) / `REVOKED`; không gọi method ghi nào

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T031 Chạy `npm run seed:permissions` và xác nhận có 3 permission mới (`POST /api/v1/orders`, `GET /api/v1/orders/me`, `GET /api/v1/orders/:orderId`) được gán cho ADMIN và cache role-permission đã bị xoá (Constitution II)
- [X] T032 Gán cả 3 permission trên cho role `CUSTOMER` theo quickstart §1 (lấy danh sách hiện có rồi `PUT /roles/:id/permissions` với danh sách cũ **+** 3 id mới — API thay toàn bộ tập); ghi bước này vào mô tả PR như bước vận hành bắt buộc khi deploy
- [X] T033 Chạy toàn bộ kịch bản quickstart S1–S8 trên môi trường dev với API chạy từ `dist` (`npm run build && npm run start:prod` — `start:dev` không validate DTO), ghi kết quả từng kịch bản vào mô tả PR
- [X] T034 Chạy các câu SQL ở quickstart §3 và xác nhận cả 6 câu đều bị DB từ chối, kèm `SELECT conname FROM pg_constraint WHERE conname = 'Entitlement_latestOrderItemId_fkey'` trả đúng 1 dòng (FR-040, SC-002, SC-003)
- [X] T035 Chạy 4 kịch bản đồng thời ở quickstart §4: (a) 5 request cùng `Idempotency-Key` → 1 đơn, số dư giảm 1 lần; (b) nhiều key khác nhau cùng customer+Product → đúng 1 đơn `200`; (c) số dư chỉ đủ một đơn → đúng 1 `200`, số dư ≥ 0; (d) mua song song với cộng số dư → không mất cập nhật (SC-001, SC-002, SC-007)
- [X] T036 Chạy `npm run prisma:generate && npm run lint && npm test && npm run build`, sửa mọi lỗi (Constitution IV)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: không phụ thuộc.
- **Foundational (Phase 2)**: sau Phase 1; chặn mọi story.
- **US1 (Phase 3)**: sau Phase 2. Tạo `order.dto.ts`, `order.controller.ts`, toàn bộ method khoá/ghi
  và `findSummaryForOrder` mà US2–US4 dùng lại.
- **US2 (Phase 4)**: sau US1 (sửa chính `createInTransaction` của T017).
- **US3 (Phase 5)**: sau US1 (bọc quanh `create` của T017, dùng `orderSelect` của T015).
- **US4 (Phase 6)**: sau US1 (dùng `findOrderForCustomer`, `toOrderOutput`, `order.controller.ts`).
- **Phase 7**: sau T016.
- **Polish (Phase 8)**: sau mọi phase cần kiểm chứng; T031–T032 cần đủ 3 route.

### Story completion order

```text
Phase 1 → Phase 2 → US1 ─┬─▶ US2
                         ├─▶ US3
                         ├─▶ US4
                         └─▶ Phase 7
                                    └─▶ Phase 8
```

### Within each story

model/DTO → repo → service → controller → test.

## Parallel Opportunities

- Phase 1: T001 ∥ T002 (T002 chỉ cần tên hằng của T001).
- Phase 2: T006 ∥ T007 sau T005.
- US1: T012 ∥ T013; T019 viết song song khi T017 xong.
- Sau US1: US2, US3, US4 và Phase 7 giao cho người khác nhau được, **nhưng** US2 và US3 cùng sửa
  `order.service.ts`, US3 và US4 cùng sửa `order.repo.ts`/`order.model.ts` → merge tuần tự trên các
  file đó. T030 (file của module entitlement) không đụng ai.

### Parallel Example: User Story 1

```text
Task: "T012 [P] [US1] Tạo order.dto.ts"
Task: "T013 [US1] Thêm method khoá vào order.repo.ts"
→ sau khi T017 xong:
Task: "T019 [P] [US1] Viết order.service.spec.ts"
```

## Implementation Strategy

### MVP First (US1 + US2 + US3)

1. Phase 1 → Phase 2.
2. US1: đường mua gói thuê bao + toàn bộ quy tắc chặn — đủ để kiểm chứng S1–S3.
3. US2: gói một lần và acquisition giá 0 — mở khoá Product miễn phí của MVP.
4. US3: chống trừ tiền hai lần — **bắt buộc trước khi cho người thật dùng**.
5. **Dừng và kiểm chứng**: quickstart S1–S6 (+ T031, T032).

### Incremental Delivery

1. US1 + US2 + US3 → deploy (đường mua an toàn).
2. US4 (lịch sử) → S7 → deploy.
3. Phase 8 §4 (đồng thời) chạy lại mỗi lần đổi logic khoá hoặc idempotency.

## Notes

- Mỗi task một commit hoặc một nhóm logic; commit message theo convention repo.
- Không cập nhật tài liệu trong `a2matex-docs` (Assumption của spec).
- Ba điểm lệch có chủ đích đã chốt ở plan (enum `OrderStatus` một giá trị, `idempotencyKey` kiểu
  `UUID`, thêm `findSummaryForOrder` vào module 006) — đừng "sửa lại cho giống docs/Submission" khi
  triển khai.
- `planning-notes.md` không phải nguồn đúng khi mâu thuẫn với research (R1: không retry; R2: kiểu
  UUID).

## Implementation Status (2026-11-21)

Toàn bộ T001–T036 đã xong và kiểm chứng trên máy local: Postgres 17 trong container, API chạy từ
`dist` (`npm run start:prod`).

### Cổng chất lượng (T036)

`npm run prisma:generate && npm run lint && npm test && npm run build` — lint 0 finding ở file mới,
**283 test / 26 file pass** (33 test mới của Order + 4 test mới cho `findSummaryForOrder`), build
sạch.

### Migration (T004, T005)

- `20261121150000_add_order` viết tay (không dùng `migrate dev --create-only` vì DB dev local đang
  có drift sẵn ở bảng `Static`, lệnh đó có thể đòi reset).
- Áp trên **DB rỗng**: cả chuỗi migration chạy sạch và `prisma migrate diff
  --from-config-datasource --to-schema prisma/schema.prisma` trả **"No difference detected"**.
- Áp tiếp trên DB dev local; FK `Entitlement_latestOrderItemId_fkey` đã tồn tại (nợ của 006 đóng
  lại).

### Kết quả từng kịch bản quickstart (T033–T035)

| Kịch bản | Kết quả |
| --- | --- |
| S1 mua gói thuê bao | `200`, `PAID`, `totalAmount="50000"`, số dư 100.000 → 50.000, quyền `ACTIVE` đúng 30 ngày, `grantSource=ORDER`, `latestOrderItemId`/`latestProductOfferId` trỏ đúng |
| S2 từ chối | quyền còn hạn → `409 EntitlementStillActive` (cả gói thuê bao lẫn gói một lần); Product `DRAFT` → `409 ProductNotPurchasable`; gói lạ → `404 ProductOfferNotFound`; `productOfferId` sai định dạng / field thừa / thiếu `Idempotency-Key` → `422`; số dư thiếu → `409 InsufficientBalance`. Số đơn và số dư không đổi |
| S3 mua lại sau khi hết hạn | cùng một row quyền, kỳ mới tính từ thời điểm mua, không nối tiếp kỳ cũ |
| S4 gói một lần | giá 0 → `200`, số dư không đổi, `oneTimePurchasedAt` được set; gói một lần thứ hai → `409 OneTimeOfferAlreadyUsed`; gói thuê bao sau đó vẫn mua được; `oneTimePurchasedAt` giữ nguyên |
| S5 quyền bị thu hồi | `409 EntitlementRevoked`, **0** lỗi 500 và **0** lần chạm `Entitlement_revoke_fields_check` trong log |
| S6 chống bấm hai lần | 3 lần gửi (kể cả key viết **hoa**) → cùng một `id` đơn, 1 row, trừ tiền 1 lần; cùng key khác gói → `409 OrderIdempotencyKeyReused`; lần thất bại không để lại row, gửi lại đúng key sau khi nạp tiền → `200` |
| S7 lịch sử | phân trang mới nhất trước, không có khối `entitlement`; sau khi Publisher đổi giá **và** bỏ gói, `offerSnapshot` + `unitPriceAmount` không đổi; đơn người khác và id lạ đều `404 OrderNotFound`; `limit=101` → `422`; `GET /orders/me` trả danh sách (không bị `:orderId` nuốt) |
| S8 phân quyền | không token → `401`; role `CUSTOMER` bị gỡ permission → `403`; gán lại → chạy bình thường |
| §3 ràng buộc DB | cả 6 câu đều bị từ chối (unique `(customerId, idempotencyKey)`, `totalAmount >= 0`, `unitPriceAmount >= 0`, `offerSnapshot` object, unique `(orderId, productId)`, FK `latestOrderItemId`) |
| §4 đồng thời | (a) 5 request cùng key → 5× `200`, **1** đơn, trừ tiền 1 lần; (b) 5 key khác nhau cùng customer+Product → 1× `200` + 4× `409`; (c) số dư chỉ đủ 1 đơn, 2 Product song song → 1× `200` + 1× `409`, số dư về 0 và không âm; (d) mua song song với cộng số dư → không mất cập nhật |

### Số tiền lớn (FR-033)

Mua một gói giá `9007199254740993` (2^53 + 1, vượt `Number.MAX_SAFE_INTEGER`): `totalAmount` trong
response, `offerSnapshot.priceAmount`, `OrderItem."unitPriceAmount"` và `Order."totalAmount"` trong
DB đều đúng từng chữ số, số dư trừ chính xác về 0 — không có bước nào đi qua `number`.

### Permission (T031, T032)

`seed:permissions` thêm đúng 3 permission (`POST /orders`, `GET /orders/me`,
`GET /orders/:orderId`) và gán ADMIN; 3 permission này đã được gán thêm cho role `CUSTOMER` qua
`PUT /roles/:id/permissions` (6 → 9 permission). Lưu ý: DB dev local còn 3 permission `/orders` cũ
đã **xoá mềm** từ nhánh `feat/order` bị bỏ — không ảnh hưởng.

### Điểm lệch so với tasks (cùng ngữ nghĩa)

- T004 viết migration bằng tay thay vì `prisma:migrate:create` (lý do ở trên); vẫn kiểm chứng bằng
  `migrate deploy` trên DB rỗng + `migrate diff`.
- T008/T013–T015 gộp vào một lần viết `order.repo.ts` thay vì khung rồi thêm dần.
- Dữ liệu kiểm chứng trên DB local do SQL tạo (3 gói cho Product `ACTIVE`, số dư customer) thay vì
  gọi API Publisher, để không đụng giới hạn tần suất đổi bảng giá; Product `f75932e9` được bật
  `ACTIVE` tạm cho kịch bản §4(c) rồi trả lại `DRAFT`.
