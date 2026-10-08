# Implementation Plan: Nạp tiền cho user qua Sepay

**Branch**: `002-sepay-wallet-topup` | **Date**: 2026-10-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-sepay-wallet-topup/spec.md`

## Summary

User nạp tiền qua chuyển khoản ngân hàng, hệ thống gắn mỗi yêu cầu nạp tiền với một mã
tham chiếu, rồi tự động nhận biết giao dịch khớp qua webhook Sepay và cộng vào số dư
(`Profile.balance`, field mới). Vì tiền thật, hệ thống phải xác thực nguồn thông báo
(FR-010), chống cộng trùng bằng unique constraint ở DB (FR-005), chủ động đối soát với
Sepay qua một cron job thay vì chỉ chờ webhook (FR-011), và giữ lại các giao dịch không
khớp được ai để xử lý tay (FR-004). Tiếp cận kỹ thuật: thêm module `src/routes/topup`
theo đúng pattern module hiện có (`profile`, `auth`), tái sử dụng `@Transactional` và
`@DistributedLock` đã có sẵn, không thêm message queue hay payment-gateway abstraction
nào (theo Nguyên tắc VI — chỉ có một provider, Sepay).

## Technical Context

**Language/Version**: TypeScript (Node.js), NestJS 11 (ESM, `tsx`)

**Primary Dependencies**: `@nestjs/*` 11, Prisma 7 (`@prisma/client` + `@prisma/adapter-pg`),
`nestjs-zod` + `zod` 4 (schema/DTO), `redis` (cache + distributed lock qua
`CacheProvider`/`@DistributedLock`); **mới**: `@nestjs/schedule` (cron job đối soát — chưa
có trong repo, xem research.md §6)

**Storage**: PostgreSQL qua Prisma (thêm 1 migration: `Profile.balance`, model
`TopUpTransaction` mới + enum `TopUpTransactionStatus`)

**Testing**: Vitest — unit test co-located (`*.spec.ts` cạnh source, như
`app.controller.spec.ts`), e2e trong `test/*.e2e-spec.ts` (`vitest.config.e2e.ts`)

**Target Platform**: Linux server hiện có (VPS, theo `specs/001-vps-deployment`) — không
thêm hạ tầng/service mới, chạy trong cùng process NestJS hiện tại

**Project Type**: Web service (NestJS REST API, single project — không có frontend trong
repo này)

**Performance Goals**: cộng số dư trong vòng 60 giây sau khi Sepay báo giao dịch qua
webhook (SC-001); job đối soát phát hiện giao dịch bị thiếu webhook trong vòng tối đa 24
giờ (SC-006), chạy mặc định mỗi 15 phút (research.md §6)

**Constraints**: endpoint webhook PHẢI là route public (`@IsPublic()`) nhưng PHẢI xác
thực bằng shared-secret API key riêng (FR-010); mọi thay đổi `Profile.balance` PHẢI đi
qua đúng một service method trong 1 DB transaction, không sửa tay; không khóa cứng cơ chế
UI (QR code, v.v.) — v1 chỉ cần trả thông tin chuyển khoản dạng text (xem Assumptions của
spec)

**Scale/Scope**: 1 module mới (`src/routes/topup`), 1 entity mới + 1 field mới trên
`Profile`, 2 endpoint mới (1 Bearer, 1 public có xác thực riêng) + mở rộng 1 endpoint có
sẵn (`GET /profiles/me`), 1 cron job nội bộ — không có admin UI/API cho việc xử lý tay
giao dịch `UNMATCHED` ở v1 (hỗ trợ qua truy cập DB trực tiếp, theo Nguyên tắc VI)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Nguyên tắc | Đánh giá |
|---|---|
| I. Schema-Validated Boundaries | PASS — request body `POST /topups` và payload webhook Sepay đều qua Zod DTO (`nestjs-zod`) trước khi vào service; biến môi trường mới (`SEPAY_WEBHOOK_API_KEY`, `SEPAY_API_BASE_URL`, `SEPAY_API_TOKEN`, thông tin tài khoản ngân hàng, interval đối soát) thêm vào `configSchema` trong `src/shared/config.ts`, app từ chối khởi động nếu thiếu. |
| II. Permission-Gated Routes | PASS — `POST /topups` nằm sau `AccessTokenGuard` + có permission record (seed tự động quét route). `POST /topups/sepay/webhook` là route public (`@IsPublic()`), không cần permission record để truy cập, nhưng vẫn được seed script quét/cataloging như mọi route khác. Role-permission cache được invalidate sau khi seed lại (dùng lại cơ chế hiện có). |
| III. Migration Discipline | PASS — 1 migration file tạo bằng `prisma migrate dev --create-only` cho `Profile.balance` + `TopUpTransaction`, apply sạch trên DB rỗng trước khi merge. |
| IV. Quality Gates Before Deploy | PASS — không đổi pipeline; `lint`/`test`/`build` vẫn là gate bắt buộc như hiện tại. |
| V. Explicit Decision Gates for Infrastructure | N/A/PASS — không đổi reverse proxy/hosting/CI; Sepay là quyết định nghiệp vụ user đã chốt trực tiếp khi gọi `/speckit-specify` ("nạp tiền qua Sepay"), không phải quyết định hạ tầng cần gate riêng. Endpoint webhook mới dùng chung port/route hiện có, không cần đổi `docker-compose`/reverse proxy. |
| VI. Simplicity / YAGNI | PASS — không tạo abstraction đa-provider cho payment (chỉ có Sepay); không thêm message queue cho reconciliation, dùng cron trong chính NestJS process; không tạo entity riêng cho giao dịch "chưa khớp" (dùng lại `TopUpTransaction` với field nullable — research.md §5); không xây admin API cho xử lý tay `UNMATCHED` vì spec không yêu cầu UI cho việc này ở v1. |

Không có vi phạm cần ghi vào Complexity Tracking.

**Re-check sau Phase 1 (data-model.md, contracts/, quickstart.md)**: không phát sinh vi
phạm mới — data model vẫn dùng 1 bảng cho cả giao dịch khớp/chưa khớp (Nguyên tắc VI),
contract webhook vẫn chỉ xác thực bằng 1 lớp API key (Nguyên tắc I/FR-010), không có
entity/route nào thiếu permission seed hoặc thiếu migration. Giữ nguyên PASS toàn bộ.

## Project Structure

### Documentation (this feature)

```text
specs/002-sepay-wallet-topup/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── topup-api.md     # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

Module mới theo đúng convention đã có của `src/routes/profile` (model → dto → error →
repo → service → controller → module), cộng thêm entity chia sẻ và migration:

```text
prisma/
└── schema.prisma                         # + Profile.balance, + model TopUpTransaction,
                                           #   + enum TopUpTransactionStatus
└── migrations/<timestamp>_add_topup/     # file migration mới (Nguyên tắc III)

src/
├── entities/
│   └── topup-transaction.model.ts        # Zod schema mirror của Prisma model (giống
│                                          #   entities/profile.model.ts)
├── routes/
│   ├── profile/
│   │   └── profile.model.ts              # SỬA: ProfileOutput thêm field `balance`
│   └── topup/                            # MỚI
│       ├── topup.module.ts
│       ├── topup.controller.ts           # POST /topups ; POST /topups/sepay/webhook
│       ├── topup.service.ts              # createTopUpRequest, handleIncomingTransaction
│       │                                  #   (dùng chung cho webhook + cron), reconcile
│       ├── topup.repo.ts                 # Prisma queries + cộng Profile.balance trong
│       │                                  #   cùng transaction
│       ├── topup.model.ts                # Zod: CreateTopUpRequestInput/Output,
│       │                                  #   SepayWebhookPayload
│       ├── topup.dto.ts                  # createZodDto wrappers
│       ├── topup.error.ts                # InvalidSepaySignatureException, v.v.
│       ├── topup.cron.ts                 # @Cron() job đối soát (FR-011)
│       └── sepay-webhook.guard.ts        # Guard riêng xác thực API key (FR-010)
└── shared/
    └── config.ts                         # SỬA: thêm SEPAY_* env vars vào configSchema

test/
└── topup.e2e-spec.ts                     # MỚI — theo pattern test/app.e2e-spec.ts
```

**Structure Decision**: Single project (NestJS backend, không có frontend trong repo
này) — module hoá theo `src/routes/<name>` đúng quy ước README (`nest g module/controller/
service routes/topup --no-spec`), không dùng cấu trúc multi-package/monorepo nào khác.
