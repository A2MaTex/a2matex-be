# Implementation Plan: Tạo đơn rút tiền cho nhà phát hành

**Branch**: `feat/withdrawal-request` | **Date**: 2026-11-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-withdrawal-request/spec.md`

## Summary

Thêm module `withdrawal` cho phép nhà phát hành rút tiền từ ví về ngân hàng. Đường tiền ra
đầu tiên của hệ thống.

Cách làm: một bảng `WithdrawalRequest` mới, hai giá trị enum mới trên sổ cái
(`WITHDRAWAL` / `WITHDRAWAL_REVERSAL`), một khoá `SystemSetting` mới cho mức tối thiểu, và
ba route đi qua `PublisherAccessPolicy` sẵn có. Tiền bị trừ ngay lúc tạo đơn, trong **cùng một
transaction** với việc ghi đơn và ghi sổ.

Toàn bộ kỷ luật khoá, chống lặp, và xử lý lỗi **sao chép nguyên** từ luồng mua hàng
(`src/routes/order/`), vì đó là luồng tiền duy nhất đã chạy production và đã qua code review.

## Technical Context

**Language/Version**: TypeScript 5.x trên Node 24, NestJS 11, ESM (`.ts` extension trong import)

**Primary Dependencies**: `@nestjs/common`, `nestjs-zod` (DTO), `zod` v4, Prisma 7 +
`@prisma/adapter-pg`

**Storage**: PostgreSQL 17 (Cloud SQL ở production, container local). Tiền là `BIGINT`, đơn vị đồng.

**Testing**: **Viết và chạy unit test đầy đủ, nhưng KHÔNG commit** (chủ repo quyết 2026-11-27).
Test sống ở `src/routes/withdrawal/test/`, chạy local bằng `npm test`, và được chặn khỏi git bằng
một dòng `.gitignore`. Ngoài ra vẫn verify bằng `dist` + HTTP thật + truy vấn database theo mẫu
spec 011 — test đơn vị không thay thế được việc kiểm hành vi transaction và ràng buộc database.

**Target Platform**: Linux container, deploy bằng docker compose lên VPS khi merge vào `staging`

**Project Type**: Web service (REST API đơn khối)

**Performance Goals**: Không có mục tiêu riêng. Đơn rút tiền là thao tác hiếm (tối đa 1
đơn/publisher/24 giờ theo FR-013), không nằm trên đường nóng nào.

**Constraints**:
- Mọi thay đổi số dư PHẢI nằm trong transaction cùng với bút toán sổ cái (FR-030)
- `CHECK (Profile.balance >= 0)` đã tồn tại trên production — vi phạm là lỗi hệ thống, nên
  điều kiện phải nằm trong chính câu lệnh `UPDATE` (FR-008)
- Thứ tự khoá phải khớp luồng mua hàng, nếu không sẽ deadlock 40P01

**Scale/Scope**: 1 module mới (~8 file), 1 bảng mới, 2 migration, 1 khoá setting, 3 route.
Production hiện có 10 ví, 7 đơn hàng, 25 bút toán — quy mô rất nhỏ.

## Constitution Check

*GATE: Phải qua trước Phase 0. Kiểm lại sau Phase 1.*

| Nguyên tắc | Đánh giá | Kết quả |
|---|---|---|
| **I — Ranh giới xác thực bằng Zod** | Mọi input qua DTO `nestjs-zod`. Số tiền dùng chuỗi thập phân có kiểm trần `BIGINT`, **không** dùng `^\d{1,19}$` trần trụi (regex đó cho qua số vượt trần → lỗi 22003 → 500, đã xảy ra ở spec 011). Khoá setting mới khai trong registry kèm schema. | **PASS** |
| **II — Route nào, Permission nào** | `create-permissions.ts` **tự quét AST** nên bản ghi sinh tự động, không sửa tay file seed. Ba route dùng `@SkipPermissionCheck()` (FR-039) nên **không bắt buộc chạy seed lúc deploy** (FR-038a) — chạy thừa sẽ xoá cache phân quyền và làm lộ grant đã mất, đúng sự cố 2026-11-23. | **PASS** (có chủ ý, ghi ở Complexity Tracking) |
| **III — Migration đi trước** | 2 migration viết tay (lý do ở research R1), áp sạch trên DB rỗng trước khi merge. DB local đã reset sạch 2026-11-27 nên `migrate dev --create-only` dùng lại được. | **PASS** |
| **IV — Cổng chất lượng** | `npm run lint` + `npm test` + build phải xanh. Test đơn vị **có viết và có chạy** ở máy local nhưng **không vào git**, nên CI chạy đúng bộ test như hiện nay. | **PASS** |
| **V — Quyết định hạ tầng rõ ràng** | 16 quyết định đã chốt trực tiếp với chủ repo trước khi viết spec. 0 `[NEEDS CLARIFICATION]`. Không có thay đổi hạ tầng nào. | **PASS** |
| **VI — Đơn giản / YAGNI** | Không abstraction mới. Không service "payout" chung. Dùng lại `PublisherAccessPolicy`, `WalletService`, `SystemSettingService`, `TransactionService`, `IdempotencyKey` — không bọc thêm lớp nào. Bảng trạng thái khai đủ 5 giá trị ngay từ đầu **không phải** trừu tượng hoá sớm mà là tránh `ALTER TYPE` lần hai (FR-022). | **PASS** |

**Kết luận gate**: qua, với một mục ghi ở Complexity Tracking.

### Kiểm lại sau Phase 1 (gate 2)

Thiết kế ở `data-model.md` và `contracts/` không làm phát sinh vi phạm mới:

- **I** — `WITHDRAWAL_MIN_AMOUNT` khai schema ở cả `system-setting.constant.ts` và registry; DTO
  số tiền kiểm trần `BIGINT` chứ không dùng `^\d{1,19}$` trần trụi (R5).
- **III** — hai migration, file 1 chỉ `ALTER TYPE ADD VALUE`, file 2 phần còn lại (R1). Lý do
  không gộp đã ghi, không phải thói quen.
- **VI** — không sinh service hay abstraction mới nào. `creditUserBalance` dùng lại hàm đã có;
  chỉ thêm `tryDebitUserBalance` vì chưa có đường trừ ví người dùng nào tồn tại.
- Phát sinh **một** thiết kế đáng ghi: `APPROVED → PAID` **không sinh bút toán nào**. Thoạt nhìn
  giống thiếu sót, nhưng tiền đã rời ví từ lúc tạo đơn; bước đó chỉ chuyển giữa hai túi trong
  phép đối soát, và hai túi tính từ `status` của đơn chứ không từ sổ cái (R10).

## Project Structure

### Documentation (this feature)

```text
specs/012-withdrawal-request/
├── plan.md              # File này
├── spec.md              # Đã có
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── withdrawal-api.md
├── checklists/
│   └── requirements.md  # Đã có
└── tasks.md             # /speckit-tasks sinh ra, KHÔNG phải plan này
```

### Source Code (repository root)

```text
prisma/
├── schema.prisma                                      # SỬA — model WithdrawalRequest, 2 enum, cột mới
└── migrations/
    ├── 2026112XXXXXXX_add_withdrawal_enum_values/     # MỚI — chỉ ALTER TYPE ADD VALUE
    └── 2026112XXXXXXX_add_withdrawal_request/         # MỚI — bảng, cột, ràng buộc, index

src/
├── routes/
│   └── withdrawal/                                    # MODULE MỚI
│       ├── withdrawal.controller.ts                   # 3 route + huỷ đơn
│       ├── withdrawal.service.ts                      # @Transactional, khoá, nghiệp vụ
│       ├── withdrawal.repo.ts                         # SQL thô cho khoá dòng
│       ├── withdrawal.model.ts                        # Zod schema
│       ├── withdrawal.dto.ts                          # DTO nestjs-zod
│       ├── withdrawal.error.ts                        # Exception
│       └── withdrawal.module.ts
├── entities/
│   └── withdrawal-request.model.ts                    # MỚI — schema trạng thái dùng chung
├── shared/constants/
│   ├── wallet.constant.ts                             # SỬA — 2 loại mới, 9 tổ hợp
│   └── withdrawal.constant.ts                         # MỚI — trạng thái, trần phân trang
├── routes/wallet/
│   ├── wallet.service.ts                              # SỬA — recordWithdrawal, recordWithdrawalReversal
│   └── wallet.repo.ts                                 # SỬA — tryDebitUserBalance
├── routes/system-setting/
│   └── system-setting.registry.ts                     # SỬA — khoá WITHDRAWAL_MIN_AMOUNT
├── shared/constants/system-setting.constant.ts        # SỬA — thêm khoá
├── seed/seed-system-settings.ts                       # SỬA — giá trị khởi tạo 100.000
└── app.module.ts                                      # SỬA — đăng ký WithdrawalModule

docs/
└── deployment-runbook.md                              # SỬA — đối soát 2 túi + mục deploy
```

**Structure Decision**: theo đúng quy ước `src/routes/<tên>/` của repo, cùng bộ 7 file mà
`order/` và `wallet/` đang dùng. Module `withdrawal` phụ thuộc `PublisherModule` (lấy
`PublisherAccessPolicy`), `WalletCoreModule` (ghi sổ) và `SystemSettingCoreModule` (đọc mức tối
thiểu) — đúng ba module mà `OrderModule` cũng nhận, dùng bản `*CoreModule` không mang controller.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| **Nguyên tắc IV — test có viết, có chạy, nhưng không commit** | Chủ repo quyết 2026-11-27. Test import service sẽ chạm `config.ts`, mà `config.ts` gọi `process.exit(1)` khi env thiếu. **Ở máy local `.env` đầy đủ nên test chạy bình thường; CI không có `.env` nên nó chết** — đó đúng là lý do commit `5b69ebd` gỡ 2 file test module order, với ghi chú "They stay on disk for local work". Giữ test ngoài git là giữ nguyên lợi ích mà không chạm vào nguyên nhân gãy. | `vi.mock` config để test chạy được cả trên CI: thêm một lớp giả vào mọi test file, dễ vỡ khi config đổi, và vẫn không kiểm được thứ đáng kiểm nhất (hành vi transaction + ràng buộc database). Sửa `config.ts` để không `process.exit` khi chạy test: đụng vào đường khởi động của production để phục vụ test — đổi chỗ rủi ro chứ không giảm. |
| **Nguyên tắc II — không chạy seed phân quyền lúc deploy** | `seed-permissions` kết thúc bằng xoá cache phân quyền; cache không có TTL nên đang che mọi grant đã mất của vai trò không phải ADMIN. Ngày 2026-11-23 việc xoá cache này làm `POST /topups` trả 403 cho toàn bộ khách. Ba route mới không cần bản ghi Permission để chạy. | Chạy seed "cho đúng quy trình": rước rủi ro mất dịch vụ để đổi lấy bản ghi mà không route nào đọc tới. Runbook của spec 010 đã kết luận y hệt cho trường hợp giống hệt. |
