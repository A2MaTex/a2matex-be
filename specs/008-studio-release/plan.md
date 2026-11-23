# Implementation Plan: Studio Release — quản lý bản phát hành ứng dụng Studio

**Branch**: `feat/studio-release` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-studio-release/spec.md`

## Summary

Thêm module `src/routes/studio-release`: bản sinh đôi của `src/routes/launcher-release` cho ứng
dụng desktop Studio. Một bảng `StudioRelease` (version, tệp cài đặt trong `Static`, ghi chú,
`isActive`, `publishedAt`), một route công khai `GET /studio-releases/current` để Studio kiểm tra
cập nhật, và 6 route Admin: danh sách, chi tiết, tạo, sửa, kích hoạt, gỡ hiệu lực — tổng 7 route. `activate` và
`deactivate` chạy trong `@DistributedLock` + `@Transactional` để luôn có nhiều nhất một bản hiệu
lực.

Bốn chỗ **khác** Launcher, đều do chủ repo chốt: `version` bắt buộc strict semver và unique (bắt
`P2002`, không pre-check — R1); bản đang hiệu lực chỉ sửa được ghi chú (R6); có thao tác gỡ hiệu
lực làm route riêng (R2); log mọi thao tác ghi chứ không chỉ `activate` (R8) — kéo theo cả bốn
method ghi phải nhận `@ActiveUser('userId')`, trong khi Launcher chỉ `activate` có. Trần `pageSize` 100
(R7) là chỗ Launcher thiếu. Tải tệp cài đặt **vẫn phải đăng nhập** như Launcher — module này không
đụng tới `static` và không mở route công khai nào khác (R9).

## Technical Context

**Language/Version**: TypeScript (Node.js, ESM, `tsx`), NestJS 11

**Primary Dependencies**: `@nestjs/*` 11, Prisma 7 (`@prisma/client` + `@prisma/adapter-pg`),
`nestjs-zod` + `zod` 4; hạ tầng sẵn có: `@DistributedLock`, `@Transactional`, `TransactionService`,
`PrismaService.getClient()`, `StaticRepository`, `AccessTokenGuard`, `@IsPublic`, `@ActiveUser`,
`getPagination`, `isUniqueConstraintPrismaError`, và hằng
`STRICT_SEMANTIC_VERSION_PATTERN` (R4). **Không thêm dependency mới.**

**Storage**: PostgreSQL qua Prisma — 1 migration `add_studio_release`: bảng `StudioRelease`, unique
index trên `version`, và partial unique index trên `isActive` (R13). Không enum mới, không đổi bảng đang có (chỉ thêm quan hệ ngược trên `Static`
ở tầng Prisma). Chi tiết: [data-model.md](./data-model.md).

**Testing**: Vitest unit co-located `src/routes/studio-release/test/*.spec.ts` (mock
`StudioReleaseRepo`, `StaticRepository`, `TransactionService`, `CacheProvider`) chạy bằng
`npm test`; thêm `test/studio-release.e2e-spec.ts` chạy bằng `npm run test:e2e` trên DB local
(R10). Kiểm chứng thủ công đầy đủ theo [quickstart.md](./quickstart.md) với API chạy từ `dist`.

**Target Platform**: Linux server hiện có (VPS, `specs/001-vps-deployment`), cùng process API.

**Project Type**: Web service (NestJS REST API, single project).

**Performance Goals**: không có mục tiêu throughput riêng. `current` là một truy vấn đọc một hàng,
được Studio gọi lúc khởi động; bảng chỉ có vài chục hàng nên không cần index ngoài PK và unique.
Không cache (R9).

**Constraints**: nhiều nhất một bản `isActive` tại mọi thời điểm, kể cả khi hai Admin thao tác đồng
thời (FR-006, FR-007); `publishedAt` chỉ ghi một lần (FR-008, R11); `version` duy nhất và đúng
strict semver (FR-003, FR-004); route `current` không bao giờ trả bản có tệp đã xoá (FR-013).

**Scale/Scope**: 1 module mới (7 file), 1 entity, 1 bảng, 1 migration, 7 route. Không cron, queue,
cache, consumer hay UI. Không đụng `launcher-release` (spec Out of Scope).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Nguyên tắc | Đánh giá |
| --- | --- |
| I. Schema-Validated Boundaries | PASS — body/query/param của 7 route qua Zod DTO (`nestjs-zod`), input `.strict()`, update có `.refine()` bắt buộc ≥1 trường, `pageSize` có `.max(100)`. Không thêm biến môi trường. |
| II. Permission-Gated Routes | PASS — 6 route Admin nằm sau `AccessTokenGuard`; `current` có `@IsPublic()` đúng như `launcher-releases/current` và `terms/current`. `npm run seed:permissions` quét controller, tạo permission, gán role Admin và tự xoá cache role-permission; bước này nằm cùng PR và được ghi trong [quickstart.md](./quickstart.md) §1 (R12). |
| III. Migration Discipline | PASS — 1 migration `add_studio_release` tạo bằng `npm run prisma:migrate:create`, viết tay nội dung, apply sạch trên DB rỗng; không backfill vì bảng mới. Thứ tự deploy: `migrate deploy` trước, đổi container sau. `npm run prisma:generate` chạy trước `build`. |
| IV. Quality Gates Before Deploy | PASS — không đổi pipeline. `lint` + `test` + `build` bắt buộc; e2e là config riêng (`*.e2e-spec.ts` không khớp `include` của `vitest.config.ts`) nên không làm chậm cổng CI (R10). |
| V. Explicit Decision Gates for Infrastructure | N/A — không đổi hạ tầng, proxy, hosting hay CI. Mọi quyết định nghiệp vụ đã chốt trực tiếp với chủ repo và ghi trong Clarifications của spec; không còn `[NEEDS CLARIFICATION]`. |
| VI. Simplicity / YAGNI | PASS — không abstraction dùng chung với `launcher-release` (hai module song song, ba dòng lặp lại tốt hơn một abstraction sớm); không enum trạng thái cho một cờ boolean (R2); không index thừa ngoài hai unique ràng buộc đúng đắn (R13); không cache; không checksum, không tách hệ điều hành, không kênh phát hành (spec Out of Scope). |

Không có vi phạm cần ghi vào Complexity Tracking.

**Re-check sau Phase 1** (data-model.md, contracts/, quickstart.md): không phát sinh vi phạm. Hai
điểm đáng ghi:

1. Nhân bản có chủ đích toàn bộ hình dạng của `launcher-release` thay vì trừu tượng hoá thành một
   module "client release" dùng chung. Lý do: hai module sẽ lệch nhau ngay từ đầu (semver, unique,
   khoá bản hiệu lực, deactivate) và chủ repo đã chốt không backport; gộp bây giờ là trừu tượng hoá
   sớm trên hai thứ đang phân kỳ (Nguyên tắc VI).
2. Giữ bộ cột xoá mềm dù không route nào set `deletedAt` (R5) — đây là **nhất quán dữ liệu** với
   mọi bảng khác trong `schema.prisma`, không phải cột cho nhu cầu giả định; chi phí là một điều
   kiện trong `where`.

## Truy vết yêu cầu

Mỗi FR của spec phải có chỗ thiết kế và chỗ kiểm chứng. Bảng này là hợp đồng đồng nhất giữa spec và
plan — thêm FR mà không thêm dòng ở đây là spec và plan đã lệch.

| FR | Thiết kế ở | Kiểm chứng ở |
| --- | --- | --- |
| FR-001, FR-002, FR-005 | [data-model.md](./data-model.md) bảng + bất biến 5; contract `POST` | quickstart S2, S3 |
| FR-003, FR-004 | [research.md](./research.md) R1, R4; contract `POST`/`PUT` | quickstart S3 |
| FR-006, FR-007 | R3, **R13** (partial unique index); data-model bất biến 1 | quickstart S4, S5, **S15** (đua thật + ràng buộc DB) |
| FR-008, FR-011 | R11; data-model bất biến 3 | quickstart S4, S5, S6 |
| FR-009, FR-010 | contract `activate` | quickstart S4, S9 |
| FR-012, FR-013 | R9; data-model truy vấn `current` | quickstart S1, S4, S9 |
| FR-014, FR-022, FR-023 | R7; data-model truy vấn danh sách | quickstart S10, S9 |
| FR-015 | contract `GET /:id` | quickstart S2 |
| FR-016 | R6; data-model bất biến 4 | quickstart S7 |
| FR-017 | R12 | quickstart S11 |
| FR-018 | R5; data-model truy vấn (lọc `deletedAt`) | quickstart S14 (đặt cờ bằng SQL) |
| FR-019 | R8 (kèm hệ quả chữ ký controller) | quickstart S13 |
| FR-020 | R9 | quickstart S12 |
| FR-021 | R2; contract `deactivate` | quickstart S8 |

## Project Structure

### Documentation (this feature)

```text
specs/008-studio-release/
├── plan.md                 # File này
├── spec.md                 # 23 FR, 7 SC, Clarifications (9 quyết định)
├── planning-notes.md       # Ghi chép kỹ thuật trước plan
├── research.md             # Phase 0 — R1…R12
├── data-model.md           # Phase 1 — bảng, migration, bất biến, truy vấn
├── quickstart.md           # Phase 1 — 15 kịch bản kiểm chứng thủ công
├── contracts/
│   └── studio-release-api.md   # Phase 1 — 7 route, mã lỗi, ví dụ
├── checklists/
│   └── requirements.md     # Chất lượng spec + lượt verify
└── tasks.md                # Phase 2 — /speckit-tasks sinh, KHÔNG phải plan này
```

### Source Code (repository root)

```text
prisma/
├── schema.prisma                                   # + model StudioRelease, + quan hệ trên Static
└── migrations/<ts>_add_studio_release/migration.sql

src/
├── app.module.ts                                   # + StudioReleaseModule
├── entities/
│   └── studio-release.model.ts                     # Zod entity, gương của launcher-release.model
└── routes/studio-release/
    ├── studio-release.controller.ts                # 7 route
    ├── studio-release.service.ts                   # inject cacheProvider + transactionService (R3)
    ├── studio-release.repo.ts                      # Prisma, lọc deletedAt
    ├── studio-release.model.ts                     # Zod input/output
    ├── studio-release.dto.ts                       # createZodDto
    ├── studio-release.error.ts                     # 7 exception (version sai định dạng là message Zod)
    ├── studio-release.module.ts
    └── test/
        └── studio-release.service.spec.ts

test/
└── studio-release.e2e-spec.ts                      # luồng chính, chạy bằng npm run test:e2e
```

**Structure Decision**: single project NestJS, module hoá theo `src/routes/<name>` đúng quy ước
README và các module đang có. Không tạo thư mục `services/` hay `utils/` con — module này nhỏ hơn
`product-release` nhiều, một service một repo là đủ.
