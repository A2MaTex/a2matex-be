# Implementation Plan: System Setting — kho cấu hình runtime cho admin

**Branch**: `feat/system-setting` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-system-setting/spec.md`

**Artifacts**: [research.md](./research.md) · [data-model.md](./data-model.md) ·
[contracts/system-setting-api.md](./contracts/system-setting-api.md) · [quickstart.md](./quickstart.md)

## Summary

Dựng một bảng cấu hình do admin quản lý, cùng một registry khai báo khóa ở phía mã nguồn, để đổi
giá trị vận hành không cần deploy. Phase 1 khai báo 4 khóa: tỉ lệ hoa hồng của sàn (chưa có bên
tiêu thụ, dành cho phase 2) và 3 trường ngân hàng SePay (chuyển ra khỏi biến môi trường, có bên
tiêu thụ thật là đường tạo yêu cầu nạp tiền).

Hướng kỹ thuật, chốt sau khi đối chiếu mã nguồn trong [research.md](./research.md):

- Một bảng `SystemSetting`, giá trị dạng JSONB, hình dạng do Zod registry quy định (R3).
- Kiểm tra toàn bộ khóa lúc khởi động bằng `OnModuleInit`, bám pattern `KeyService` — không dùng
  được cơ chế `safeParse(process.env)` của `config.ts` vì cấu hình nằm trong database (R1).
- **Tách hai module**: `SystemSettingCoreModule` không có controller cho cron import,
  `SystemSettingModule` có controller cho app chính (R2). Đây là ràng buộc bảo mật, không phải
  chuyện gọn gàng.
- Chuyển đổi bằng **hai lần merge `staging`** để không có khoảng nào khách thấy thông tin chuyển
  khoản trống (R7).

## Technical Context

**Language/Version**: TypeScript 6.0 trên Node >= 22, ESM, chạy dev bằng `tsx`, build bằng `tsc`

**Primary Dependencies**: NestJS 11.2, Prisma 7.10 (SQL-first migration), `nestjs-zod` 5.5 + Zod
4.6 cho DTO và validation, Redis cho cache role-permission

**Storage**: PostgreSQL (Cloud SQL `a2matex_dev` cho `staging`; local qua `npm run compose-up`).
Bảng mới `SystemSetting`, một dòng cho mỗi khóa.

**Testing**: vitest (`npm test`), e2e riêng `npm run test:e2e`. Verify thủ công theo
[quickstart.md](./quickstart.md) chạy trên database local.

**Target Platform**: container Linux trên GCP VM, sau Caddy. Hai tiến trình liên quan: app chính
(`src/main.ts`) và cron server (`src/cron/main.ts`).

**Project Type**: web service (REST API), module hoá theo `src/routes/<name>/`

**Performance Goals**: mỗi lần đọc cấu hình là một lần đánh index `UNIQUE(key)`. Phase 1 chỉ có
một đường đọc (`POST /topups`), không phải route nóng. Không cache (R9).

**Constraints**:
- Không được để tiến trình nào khởi động với cấu hình thiếu hoặc hỏng (FR-006).
- Không được lộ route admin trên cổng cron server (R2).
- Không có khoảng thời gian nào trả về thông tin ngân hàng trống trong lúc chuyển đổi (FR-014).

**Scale/Scope**: 4 khóa ở phase 1, dự kiến dưới 20 khóa trong tương lai gần. Hai route mới. Một
bảng mới. Sửa 1 service có sẵn (`TopUpService`).

## Constitution Check

*GATE: phải pass trước Phase 0. Đã re-check sau Phase 1 design — kết quả ở cuối mục.*

| Nguyên tắc | Áp dụng thế nào | Trạng thái |
|-----------|------------------|-----------|
| **I — Ranh giới xác thực bằng Zod** | Registry khai báo Zod schema cho từng khóa; DTO request/response dùng `createZodDto`. Kiểm tra lúc khởi động (R1) giữ nguyên tinh thần "từ chối khởi động thay vì đoán" sau khi 3 trường SePay rời `config.ts`. | **PASS** |
| **II — Route nào permission nấy** | Hai route mới nằm sau `AccessTokenGuard`. `npm run seed:permissions` tự quét controller, tự gán cho role Admin, tự xoá cache Redis (`create-permissions.ts:302-327`). Seed chạy trong cùng PR. | **PASS** |
| **III — Migration đi trước** | Một migration SQL-first qua `npm run prisma:migrate:create`, tạo bảng + 4 dòng seed. Phải áp dụng sạch trên database rỗng. Deploy chạy `migrate deploy` trước khi thay container. | **PASS** |
| **IV — Cổng chất lượng** | `npm run lint`, `npm test`, `npm run build` phải pass trước khi mở PR. Lưu ý R8: `typescript/no-floating-promises` là lỗi, nên việc đổi `getBankTransferConfig` sang async phải `await` đủ chỗ. | **PASS** |
| **V — Quyết định hạ tầng phải có spec** | Việc chuyển cấu hình SePay ra khỏi biến môi trường chính là thay đổi cần cổng này; spec 009 là cổng đó. Mọi lựa chọn mở đã chốt trong Clarifications hoặc ghi ở Assumptions. | **PASS** |
| **VI — YAGNI** | Không cache (R9), không lịch hiệu lực tương lai, không phân quyền theo khóa, không bảng lịch sử riêng (dùng `auditHistory` có sẵn). Việc tách hai module là bắt buộc vì lý do bảo mật cụ thể (R2), không phải trừu tượng hoá phòng xa. | **PASS** |

**Security & Secrets**: không có secret nào chuyển vào database. `SEPAY_WEBHOOK_API_KEY` và
`SEPAY_API_TOKEN` ở lại `.env` với lý do đã ghi trong spec (Clarifications) và research.

**Re-check sau Phase 1 design**: không phát sinh vi phạm mới. Mục Complexity Tracking để trống.

## Project Structure

### Documentation (this feature)

```text
specs/009-system-setting/
├── spec.md
├── plan.md                              # file này
├── research.md                          # Phase 0 — đối chiếu giả định + 9 quyết định kỹ thuật
├── data-model.md                        # Phase 1
├── quickstart.md                        # Phase 1 — kịch bản verify chạy được
├── contracts/
│   └── system-setting-api.md            # Phase 1
├── checklists/
│   └── requirements.md
└── tasks.md                             # do /speckit-tasks sinh ra, chưa có
```

### Source Code (repository root)

```text
src/
├── routes/
│   └── system-setting/                          # MỚI
│       ├── system-setting.controller.ts         # 2 route admin
│       ├── system-setting.dto.ts                # createZodDto wrapper
│       ├── system-setting.error.ts              # lỗi domain ổn định
│       ├── system-setting.model.ts              # Zod input/output
│       ├── system-setting.module.ts             # có controller, import core
│       ├── system-setting-core.module.ts        # KHÔNG controller — cron import cái này
│       ├── system-setting.registry.ts           # khai báo khóa: schema + mô tả
│       ├── system-setting.repo.ts               # đọc/ghi + append auditHistory bằng raw SQL
│       ├── system-setting.service.ts            # OnModuleInit, đọc có kiểu, ghi kèm audit
│       └── test/                                # MỚI — quy ước repo: src/routes/<name>/test/
│           ├── system-setting.registry.spec.ts  # khóa lạ bị từ chối; parse đúng/sai theo từng khóa
│           ├── system-setting.service.spec.ts   # OnModuleInit fail khi thiếu dòng / value hỏng
│           └── system-setting.repo.spec.ts      # append auditHistory đúng 1 phần tử, from/to đúng
├── entities/
│   └── system-setting.model.ts                  # MỚI — entity schema
├── shared/
│   ├── config.ts                                # SỬA (bước 2) — gỡ 3 biến SEPAY_BANK_*
│   └── constants/
│       └── system-setting.constant.ts           # MỚI — tên khóa
├── routes/topup/
│   ├── topup-core.module.ts                     # SỬA — import SystemSettingCoreModule
│   └── topup.service.ts                         # SỬA — đọc từ setting, hàm thành async (R8)
├── seed/
│   └── seed-system-settings.ts                  # MỚI — nạp giá trị từ .env vào dòng rỗng (R7)
└── app.module.ts                                # SỬA — import SystemSettingModule

prisma/
├── schema.prisma                                # SỬA — qua migration workflow
└── migrations/<timestamp>_add_system_setting/   # MỚI

package.json                                     # SỬA — thêm script seed:settings
.env.example / .env.production.example           # SỬA (bước 2) — gỡ 3 biến
```

**Structure Decision**: theo đúng quy ước `src/routes/<name>/` của repo, với một khác biệt duy
nhất là **hai module thay vì một**, sao chép nguyên mô hình `TopUpCoreModule` / `TopUpModule`.
Lý do bắt buộc: `CronModule` import `TopUpCoreModule`, mà `TopUpService` sắp phụ thuộc
`SystemSettingService`; nếu service và controller nằm chung một module thì hai route admin sẽ lộ
ra trên cổng cron server. Chi tiết ở [research.md](./research.md) R2.

## Thứ tự triển khai

Xếp theo ràng buộc kỹ thuật, không phải theo độ ưu tiên nghiệp vụ.

| Bước | Nội dung | Vì sao ở vị trí này |
|------|----------|---------------------|
| 1 | Migration + `schema.prisma` + **`npm run prisma:generate`** + entity schema | Mọi thứ khác đọc từ bảng này. Quên `prisma:generate` thì `npm run build` fail với TS2694 vì `src/generated/prisma` còn cũ |
| 2 | Registry 4 khóa + constant tên khóa | Service và migration seed đều tham chiếu |
| 3 | Repo + Service (gồm `OnModuleInit`) + core module | Phần lõi, chưa lộ HTTP |
| 4 | Controller + DTO + module + `app.module.ts` | Cần service xong trước |
| 5 | `seed:permissions` + kiểm tra cache đã xoá | Cần controller tồn tại để quét ra route |
| 6 | Seed script nạp giá trị từ `.env` | Cần bảng và registry xong |
| 7 | `TopUpService` đọc từ setting + `TopUpCoreModule` import core module | Cần service xong; đây là chỗ FR-015 hoàn tất |
| 8 | Unit test 3 file ở trên + verify theo quickstart trên database local | Nguyên tắc IV. Quickstart là verify thủ công, không thay được `npm test` |
| 9 | **Deploy bước 1** — merge `staging`, chạy migration, chạy seed settings | Phải chạy khi `.env` còn giá trị |
| 10 | **Deploy bước 2** — gỡ 3 biến khỏi `config.ts` và các file env | Chỉ sau khi bước 9 xác nhận DB đã có giá trị |

Bước 9 và 10 là hai lần merge riêng. Bước 10 **không được gộp** vào bước 9: gộp lại thì lúc seed
script chạy, 3 biến đã bị gỡ khỏi `config.ts` và không còn gì để đọc.

## Rủi ro và cách xử lý

| Rủi ro | Xử lý |
|--------|-------|
| Container mới không khởi động được vì thiếu dòng cấu hình | Migration tạo sẵn cả 4 dòng, 3 dòng ngân hàng rỗng (R6). Kiểm tra lúc khởi động chỉ đòi *có dòng và parse được*, không đòi khác rỗng. |
| Route admin lộ trên cổng cron | Tách `SystemSettingCoreModule` không controller (R2). Verify bằng cách gọi route đó vào cổng cron và phải nhận 404. |
| Quên `await` sau khi hàm thành async | `oxlint --type-aware` bật `typescript/no-floating-promises` ở mức lỗi, chặn ngay ở cổng lint |
| Cron server cũng fail khởi động khi cấu hình hỏng | Là hành vi mong muốn, ghi rõ trong quickstart để không bị hiểu là hồi quy |
| Seed script chạy nhầm lần hai, ghi đè giá trị admin vừa sửa | Seed chỉ ghi vào dòng đang **rỗng**, không đụng dòng đã có giá trị |
| Seed script vi phạm `SystemSetting_updatedBy_check` | Constraint bắt `updatedAt` và `updatedById` cùng null hoặc cùng khác null. Seed **để cả hai null**: không có người nào sửa, giá trị chỉ được chuyển chỗ từ biến môi trường sang database. Dòng vẫn ở trạng thái "chưa từng sửa", đúng sự thật. Không đi tra admin id như `create-permissions.ts:getAdminSeedContext` vì gán một admin bất kỳ làm người sửa là ghi sai lịch sử. |
| Check constraint không chặn được giá trị thiếu trường `rateBps` | Đã biết và ghi rõ ở R4; tầng Zod chặn phần đó |

## Complexity Tracking

Không có vi phạm constitution nào cần biện minh.
