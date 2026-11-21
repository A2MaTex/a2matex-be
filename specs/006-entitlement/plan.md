# Implementation Plan: Entitlement — quyền sử dụng Product của customer

**Branch**: `006-entitlement` | **Date**: 2026-11-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-entitlement/spec.md`

## Summary

Thêm module `src/routes/entitlement` quản lý quyền bền vững của customer với Product: mỗi cặp
(customer, Product) một row, trạng thái lưu `ACTIVE`/`REVOKED` còn `EXPIRED` suy ra lúc đọc bằng
`now()` của DB. Admin cấp quyền (chỉ cho Product `ACTIVE`, ghi đè kỳ) và thu hồi (bắt buộc lý do);
gỡ thu hồi xoá revoke fields, lịch sử giữ trong mảng `auditHistory` JSONB trên chính row (pattern
sẵn có của `User`/`PublisherAccount`). Customer xem My Products. Module export `checkUsage` cho
Download/Launcher/Lease và `lockForPurchase` + `activateFromOrder` cho Order (spec 007), tham gia
transaction của caller qua `TransactionContext` có sẵn. Đồng thời được giữ bằng row lock theo thứ
tự chung `Product → ProductOffer → Profile → Entitlement`.

## Technical Context

**Language/Version**: TypeScript (Node.js, ESM, `tsx`), NestJS 11

**Primary Dependencies**: `@nestjs/*` 11, Prisma 7 (`@prisma/client` + `@prisma/adapter-pg`),
`nestjs-zod` + `zod` 4; hạ tầng có sẵn: `TransactionService`/`@Transactional`,
`TransactionContext`, `PrismaService.getClient()`, `AccessTokenGuard`, `@ActiveUser`,
`getPagination`. Không thêm dependency mới.

**Storage**: PostgreSQL qua Prisma — 1 migration: 2 enum + bảng `Entitlement` (constraint hai chiều
cho revoke fields, `auditHistory` JSONB); `latestOrderItemId` chưa có FK (research R8).

**Testing**: Vitest unit test co-located ở `src/routes/entitlement/test/*.spec.ts`; ràng buộc DB và
đồng thời kiểm chứng thủ công theo [quickstart.md](./quickstart.md).

**Target Platform**: Linux server hiện có (VPS, `specs/001-vps-deployment`), cùng process API.

**Project Type**: Web service (NestJS REST API, single project).

**Performance Goals**: không có mục tiêu throughput riêng; thao tác Admin tần suất thấp, My Products
là truy vấn có phân trang theo index `(customerId, productId)`. Thay đổi quyền có hiệu lực ngay ở
request kế tiếp (SC-001, SC-002) — không cache.

**Constraints**: mọi so sánh thời gian dùng `now()` của transaction (FR-012); audit ghi cùng câu lệnh
với thay đổi (FR-040); không lộ thông tin thu hồi/audit cho customer (FR-050).

**Scale/Scope**: 1 module mới, 1 bảng mới, 4 route (1 customer, 3 admin), 3 method contract nội bộ.
Không có cron, queue, cache hay UI.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Nguyên tắc | Đánh giá |
|---|---|
| I. Schema-Validated Boundaries | PASS — body/query/param của 4 route đều qua Zod DTO (`nestjs-zod`), body strict; `expiresAt` bắt buộc có mặt (R9). Không thêm biến môi trường. |
| II. Permission-Gated Routes | PASS — 4 route nằm sau `AccessTokenGuard`; `seed:permissions` quét và gán ADMIN, tự xoá cache; `GET /entitlements/me` gán cho `CUSTOMER` qua Role API như các route customer hiện có (R6). Bước gán ghi trong quickstart và phải làm cùng đợt deploy. |
| III. Migration Discipline | PASS — 1 migration `add_entitlement` tạo bằng `prisma:migrate:create`, độc lập với 007 (FK `OrderItem` để migration 007 thêm — R8), apply sạch trên DB rỗng. |
| IV. Quality Gates Before Deploy | PASS — không đổi pipeline; lint/test/build bắt buộc. |
| V. Explicit Decision Gates for Infrastructure | N/A — không đổi hạ tầng/CI/hosting. Các quyết định nghiệp vụ đã chốt trong Clarifications của spec. |
| VI. Simplicity / YAGNI | PASS — dùng lại pattern `auditHistory` thay vì tạo bảng `AuditLog` (R1); enum chỉ 2 giá trị (R3); không cron (Clarification); dùng `TransactionContext` thay vì truyền tx client (R2); không thêm test infra. |

Không có vi phạm cần ghi vào Complexity Tracking.

**Re-check sau Phase 1 (data-model.md, contracts/, quickstart.md)**: không phát sinh vi phạm. Thiết
kế vẫn 1 bảng, không dependency mới, mọi route có permission và DTO Zod. Một điểm lệch có chủ đích
so với `planning-notes.md` và mục Key Entities của spec: "bản ghi kiểm toán" được hiện thực bằng mảng
`auditHistory` trên row thay vì bảng riêng — vẫn đáp ứng FR-040/SC-005 (append-only theo code path,
cùng câu lệnh, giữ lịch sử khi grant lại). Giữ nguyên PASS.

## Project Structure

### Documentation (this feature)

```text
specs/006-entitlement/
├── spec.md
├── planning-notes.md        # đầu vào kỹ thuật từ lúc viết spec (một phần được research thay thế)
├── plan.md                  # file này
├── research.md              # Phase 0
├── data-model.md            # Phase 1
├── quickstart.md            # Phase 1
├── contracts/
│   └── entitlement-api.md   # Phase 1 — HTTP + contract nội bộ
├── checklists/
│   └── requirements.md
└── tasks.md                 # Phase 2 (/speckit-tasks — chưa tạo)
```

### Source Code (repository root)

Theo convention module hiện có (`product-offer`, `user`): model → dto → error → repo → service →
controller → module.

```text
prisma/
├── schema.prisma                              # + enum EntitlementStatus, EntitlementGrantSource,
│                                              #   + model Entitlement, + relation trên User/Product/ProductOffer
└── migrations/<timestamp>_add_entitlement/
    └── migration.sql                          # bảng, constraint, index (data-model.md)

src/
├── entities/
│   └── entitlement.model.ts                   # Zod mirror của model (như entities/product-offer.model.ts)
├── shared/constants/
│   └── entitlement.constant.ts                # status, grant source, effective status, reason max 2000,
│                                              #   grantSnapshot MVP, audit action
├── routes/entitlement/                        # MỚI
│   ├── entitlement.module.ts                  # PrismaService/TransactionService từ SharedModule (@Global);
│   │                                          #   exports EntitlementService; KHÔNG import OrderModule
│   ├── entitlement.controller.ts              # GET /entitlements/me
│   ├── admin-entitlement.controller.ts        # GET /admin/entitlements, POST grant, POST :id/revoke
│   ├── entitlement.service.ts                 # grant, revoke, listMine, listAdmin,
│   │                                          #   checkUsage, lockForPurchase, activateFromOrder
│   ├── entitlement.repo.ts                    # SQL khoá (FOR UPDATE + transactionNow), upsert,
│   │                                          #   append auditHistory, truy vấn list có effective status
│   ├── entitlement.model.ts                   # Zod input/output (contracts/entitlement-api.md)
│   ├── entitlement.dto.ts                     # createZodDto wrappers
│   ├── entitlement.error.ts                   # 5 exception (contract)
│   └── test/
│       ├── entitlement.service.spec.ts
│       └── entitlement.controller.spec.ts
└── app.module.ts                              # SỬA: import EntitlementModule
```

**Structure Decision**: single NestJS project, một module mới `src/routes/entitlement` với hai
controller (customer và admin) chung một service, theo tiền lệ `product` (`product.controller.ts` +
`marketplace-product.controller.ts`) và `admin/users`. Không chạm module khác ngoài `app.module.ts`
và `schema.prisma`.

## Complexity Tracking

Không có vi phạm Constitution.
