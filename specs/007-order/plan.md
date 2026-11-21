# Implementation Plan: Order — customer mua quyền dùng Product bằng số dư

**Branch**: `007-order` | **Date**: 2026-11-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-order/spec.md`

## Summary

Thêm module `src/routes/order`: customer mua một gói (`ProductOffer`) của Product bằng số dư trong
`Profile.balance`. Một `@Transactional()` duy nhất làm tất cả: khoá
`Product → ProductOffer → Profile → Entitlement`, kiểm tra theo đúng thứ tự FR-003 (gói/Product tồn
tại → Product đang bán → hồ sơ customer → quyền không bị thu hồi → quyền không còn hiệu lực → suất
một lần → đủ số dư), trừ số dư bằng câu cập nhật có điều kiện, tạo `Order` + `OrderItem` kèm
`offerSnapshot` bất biến, rồi gọi `EntitlementService.activateFromOrder` của spec 006 trong cùng
transaction. Chống bấm mua hai lần bằng `Idempotency-Key` theo đúng pattern đã chạy của
`SubmissionService.create` (tra trước → tra lại khi thất bại → unique `(customerId, idempotencyKey)`
là chốt chặn cuối), với cột kiểu `UUID` để chữ hoa/thường không tạo ra hai khoá khác nhau. Hai route
đọc trả lịch sử của chính customer. Migration cũng đóng lại khoản nợ của 006: thêm FK
`Entitlement.latestOrderItemId → OrderItem(id)`.

## Technical Context

**Language/Version**: TypeScript (Node.js, ESM, `tsx`), NestJS 11

**Primary Dependencies**: `@nestjs/*` 11, Prisma 7 (`@prisma/client` + `@prisma/adapter-pg`),
`nestjs-zod` + `zod` 4; hạ tầng sẵn có: `TransactionService`/`@Transactional`, `TransactionContext`,
`PrismaService.getClient()`, `AccessTokenGuard`, `@ActiveUser`, `@IdempotencyKey`, `getPagination`,
`zBigIntAsString`, và `EntitlementService` của spec 006. **Không thêm dependency mới.**

**Storage**: PostgreSQL qua Prisma — 1 migration `add_order`: enum `OrderStatus` (một giá trị
`PAID`, research R3), bảng `Order`, bảng `OrderItem`, và `ALTER TABLE "Entitlement"` thêm FK
`latestOrderItemId → OrderItem(id)` (R14). Chi tiết: [data-model.md](./data-model.md).

**Testing**: Vitest unit test co-located `src/routes/order/test/*.spec.ts` (mock `OrderRepo`,
`EntitlementService`, `TransactionService`); ràng buộc DB, khoá và đồng thời kiểm chứng thủ công
theo [quickstart.md](./quickstart.md) với API chạy từ `dist`.

**Target Platform**: Linux server hiện có (VPS, `specs/001-vps-deployment`), cùng process API.

**Project Type**: Web service (NestJS REST API, single project).

**Performance Goals**: không có mục tiêu throughput riêng. Một lần mua là một transaction ngắn với
4 row lock; `GET /orders/me` đi theo index `("customerId", "createdAt" DESC)`. Quyền có hiệu lực
ngay ở request kế tiếp (SC-006) — không cache.

**Constraints**: toàn bộ lần mua là một transaction (FR-002); mọi mốc thời gian dùng
`transactionNow` lấy từ `now()` của DB ở câu khoá `Product` (FR-009); số dư không bao giờ âm
(FR-004); tiền là `BIGINT` trong DB và decimal string trên API (FR-033); không retry (R1).

**Scale/Scope**: 1 module mới, 2 bảng mới, 1 enum, 3 route (đều của customer), 1 method đọc thêm
vào `EntitlementService`. Không cron, queue, cache hay UI.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Nguyên tắc | Đánh giá |
|---|---|
| I. Schema-Validated Boundaries | PASS — body/query/param của 3 route qua Zod DTO (`nestjs-zod`), body và query `.strict()`; `Idempotency-Key` validate bằng `z.uuid()` trong `@IdempotencyKey`. Không thêm biến môi trường (giới hạn giá/thời lượng đã do `PRODUCT_OFFER_*` kiểm soát ở tầng tạo gói). |
| II. Permission-Gated Routes | PASS — 3 route sau `AccessTokenGuard`; `seed:permissions` quét và gán ADMIN, tự xoá cache; gán cho role `CUSTOMER` qua Role API là bước vận hành bắt buộc, ghi trong [quickstart.md](./quickstart.md) §1 và R10. |
| III. Migration Discipline | PASS — 1 migration `add_order` tạo bằng `prisma:migrate:create`, viết tay nội dung, apply sạch trên DB rỗng; FK thêm vào `Entitlement` không cần backfill vì cột hiện luôn `NULL` (R14). Thứ tự deploy: `migrate deploy` trước, đổi container sau. |
| IV. Quality Gates Before Deploy | PASS — không đổi pipeline; `lint` + `test` + `build` bắt buộc, kèm `prisma:generate` trước `build` (bẫy đã gặp ở 006). |
| V. Explicit Decision Gates for Infrastructure | N/A — không đổi hạ tầng/CI/hosting. Quyết định nghiệp vụ duy nhất còn mở ("mua khi quyền còn hiệu lực") đã được chủ repo chốt là **chặn hoàn toàn** và ghi trong Clarifications của spec. |
| VI. Simplicity / YAGNI | PASS — enum `OrderStatus` chỉ chứa giá trị thực sự được ghi (R3); không cột `updatedAt`/`deletedAt` cho bảng bất biến; không vòng retry (R1); không cột `requestHash` vì input chỉ một trường (R5); dùng lại `ProductNotFoundException`, `@IdempotencyKey`, `TransactionContext` và contract 006 thay vì tạo cơ chế mới. |

Không có vi phạm cần ghi vào Complexity Tracking.

**Re-check sau Phase 1 (data-model.md, contracts/, quickstart.md)**: không phát sinh vi phạm. Ba
điểm lệch có chủ đích, đều đã ghi lý do trong [research.md](./research.md):

1. **`OrderStatus` chỉ có `PAID`** thay vì 4 giá trị như `a2matex-docs/.../04_commerce_entitlement_execution.md` §3 — ba giá trị kia không bao giờ được ghi trong MVP (FR-005 rollback khi thất bại). Spec Key Entities vẫn được thoả vì cột `status` vẫn tồn tại và vẫn nằm trong response (R3).
2. **`idempotencyKey` kiểu `UUID`** thay vì `VARCHAR(255)` như `Submission` — `z.uuid()` chấp nhận chữ hoa nên `VARCHAR` tạo được hai khoá cho cùng một lần bấm mua; đây là đường tiền nên chọn kiểu chặt hơn (R2).
3. **Thêm một method đọc vào `EntitlementService`** (`findSummaryForOrder`) — nằm trong module sở hữu bảng `Entitlement`, giữ nguyên quy ước "mỗi module đọc bảng của mình" và cho phép response của `POST /orders` có cùng shape ở cả lần mua đầu lẫn lần replay (R8, FR-022).

Một điểm **sửa lại so với `planning-notes.md`**: không có vòng retry cho deadlock/serialization —
đọc code thì repo không hề có cơ chế đó; `P2028` map thành `503` là đủ và đúng tiền lệ (R1).

## Project Structure

### Documentation (this feature)

```text
specs/007-order/
├── spec.md
├── planning-notes.md        # đầu vào kỹ thuật lúc viết spec (R1, R2 thay thế một phần)
├── plan.md                  # file này
├── research.md              # Phase 0 — R1..R15
├── data-model.md            # Phase 1 — bảng, constraint, index, bất biến
├── quickstart.md            # Phase 1 — kịch bản kiểm chứng S1..S8, ràng buộc DB, đồng thời
├── contracts/
│   └── order-api.md         # Phase 1 — HTTP + contract nội bộ với Entitlement
├── checklists/
│   └── requirements.md
└── tasks.md                 # Phase 2 (/speckit-tasks — chưa tạo)
```

### Source Code (repository root)

Theo convention module hiện có (`entitlement`, `product-offer`, `submission`): constants → entity
model → model → dto → error → repo → service → controller → module.

```text
prisma/
├── schema.prisma                         # + enum OrderStatus, + model Order, + model OrderItem,
│                                         #   + relation Entitlement.latestOrderItemId → OrderItem,
│                                         #   + back-relation trên User/Product/ProductOffer
└── migrations/<timestamp>_add_order/
    └── migration.sql                     # 2 bảng + constraint/index + ALTER TABLE "Entitlement"

src/
├── entities/
│   └── order.model.ts                    # Zod mirror của Order/OrderItem (như entities/entitlement.model.ts)
├── shared/constants/
│   └── order.constant.ts                 # OrderStatus, ORDER_OFFER_SNAPSHOT_SCHEMA_VERSION = '1.0',
│                                         #   ORDER_PAGE_SIZE_MAX = 100
├── routes/order/                         # MỚI
│   ├── order.module.ts                   # imports: EntitlementModule; KHÔNG được import ngược lại
│   ├── order.controller.ts               # POST /orders, GET /orders/me, GET /orders/:orderId
│   │                                     #   (khai báo 'me' TRƯỚC ':orderId' — R10)
│   ├── order.service.ts                  # create (idempotency + transaction mua), listMine, findOne
│   ├── order.repo.ts                     # findByIdempotencyKey, lockProduct, lockOffer,
│   │                                     #   lockCustomerProfile (trả balance + transactionNow),
│   │                                     #   debitBalance, createOrderWithItem, listMine, findOneForCustomer
│   ├── order.model.ts                    # Zod input/output theo contracts/order-api.md
│   ├── order.dto.ts                      # createZodDto wrappers
│   ├── order.error.ts                    # 10 exception (contract §4)
│   └── test/
│       ├── order.service.spec.ts
│       └── order.controller.spec.ts
├── routes/entitlement/                   # SỬA (nhỏ)
│   ├── entitlement.service.ts            # + findSummaryForOrder (R8)
│   ├── entitlement.repo.ts               # + truy vấn đọc theo (customerId, productId) cho method trên
│   ├── entitlement.model.ts              # + kiểu trả về của summary
│   └── test/entitlement.service.spec.ts  # + test cho findSummaryForOrder
└── app.module.ts                         # SỬA: import OrderModule
```

**Structure Decision**: single NestJS project, một module mới `src/routes/order` với **một**
controller (chỉ có route customer, khác 006 vì không có mặt quản trị trong phạm vi này). Module
import `EntitlementModule` để dùng `lockForPurchase`/`activateFromOrder`/`findSummaryForOrder`;
`Profile.balance` do `OrderRepo` thao tác trực tiếp vì không có `ProfileService` nào sở hữu chiều
trừ tiền (tiền lệ: `topup.repo.ts` cũng tự cộng balance). Ngoài `app.module.ts`, `schema.prisma` và
bốn file nhỏ trong `routes/entitlement`, không chạm module khác.

## Complexity Tracking

Không có vi phạm Constitution.
