# Implementation Plan: Quản trị viên duyệt đơn rút tiền và xem sổ cái

**Branch**: `feat/withdrawal-admin` | **Date**: 2026-11-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-withdrawal-admin/spec.md`

## Summary

Đóng vòng đời đơn rút tiền mà spec 012 để ngỏ, và mở đường đọc dữ liệu tiền đầu tiên cho quản
trị viên.

**Không có migration nào.** Spec 012 đã khai sẵn đủ 5 trạng thái và các cột `bankTransferRef`,
`rejectionReason`, `processedById`, `processedAt`. Việc còn lại thuần tầng ứng dụng: ba lần đổi
trạng thái, một đường hoàn tiền, và bốn truy vấn đọc.

Ba lần đổi trạng thái đều dùng **một câu `UPDATE` có điều kiện** — khuôn đã chứng minh ở spec 012
bằng ca kiểm 5 lệnh huỷ song song ra 1 thành công + 4 từ chối nghiệp vụ, không một lỗi hệ thống nào.

## Technical Context

**Language/Version**: TypeScript trên Node 24, NestJS 11, ESM

**Primary Dependencies**: `@nestjs/common`, `nestjs-zod`, `zod` v4, Prisma 7

**Storage**: PostgreSQL 17. **Không thêm bảng, không thêm cột, không migration.**

**Testing**: viết đầy đủ. Test **chỉ import schema thuần** thì commit được; test import service
thì để local và chặn bằng `.gitignore` — spec 012 đã đo: service chạm `config.ts` nên chết khi CI
không có `.env`, còn schema thuần thì chạy tốt.

**Target Platform**: Linux container, deploy khi merge vào `staging`

**Project Type**: Web service (REST API đơn khối)

**Performance Goals**: không có mục tiêu riêng. Production hiện có 10 bút toán rút tiền và vài
chục bút toán tổng — bảng đối soát quét toàn bảng vẫn rẻ hơn mọi phương án cache.

**Constraints**:
- Đổi trạng thái và hoàn tiền phải cùng transaction (FR-025)
- Thứ tự khoá phải khớp order/wallet/withdrawal, nếu không deadlock 40P01
- Không tình huống nghiệp vụ nào được thành lỗi hệ thống (FR-039)

**Scale/Scope**: 7 route mới, 2 controller mới, 0 migration. Khoảng 10 file.

## Constitution Check

*GATE: phải qua trước Phase 0. Kiểm lại sau Phase 1.*

| Nguyên tắc | Đánh giá | Kết quả |
|---|---|---|
| **I — Zod ở mọi ranh giới** | Mọi input qua DTO `nestjs-zod`. Hai danh sách có trần phân trang (FR-007a). Khoảng thời gian kiểm bắt-đầu ≤ kết-thúc (FR-029). Không có số tiền nào do người gọi nhập, nên không gặp lại bẫy trần BIGINT. | **PASS** |
| **II — Route nào, Permission nào** | Bảy route đều **gác quyền thật**, khuôn `AdminEntitlementController`. `create-permissions.ts` quét AST tự sinh và tự cấp cho ADMIN. **Lần deploy này BẮT BUỘC chạy seed** — ngược với spec 012, và đã kiểm 2026-11-27 là an toàn. | **PASS** |
| **III — Migration đi trước** | Không có migration. Không đụng `schema.prisma`. | **PASS** (không áp dụng) |
| **IV — Cổng chất lượng** | lint + test + build xanh. Test service để local, test schema commit được. | **PASS** |
| **V — Quyết định rõ ràng** | 8 quyết định chốt trực tiếp với chủ repo; 2 câu rẽ nhánh (một bước hay hai bước; phạm vi) được hỏi và chốt. 0 `[NEEDS CLARIFICATION]`. | **PASS** |
| **VI — YAGNI** | Không abstraction mới. Dùng lại `WithdrawalRepo`, `WalletRepo`, `WalletService`, `TransactionService`. Hai controller mới đặt vào **module đã có** thay vì dựng module mới. Không cache, không bảng nhật ký, không cảnh báo tự động. | **PASS** |

**Kết luận gate**: qua, không có mục nào cần ghi ở Complexity Tracking.

### Kiểm lại sau Phase 1 (gate 2)

- **VI** — `findSystemAccountBalance` trong `wallet.repo.ts` là code chết từ spec 011 (0 người
  gọi). Bảng đối soát nay gọi nó, nên hàm đó sống lại thay vì phải viết mới hoặc xoá đi.
- Phát sinh **một** thiết kế đáng ghi: đường duyệt và đường đánh dấu đã chi **không khoá `Profile`**,
  vì chúng không đụng số dư. Chỉ đường từ chối mới khoá. Xem research R4 cho phần phân tích chu
  trình khoá.

## Project Structure

### Documentation (this feature)

```text
specs/013-withdrawal-admin/
├── plan.md              # File này
├── spec.md              # Đã có — 42 FR, 10 SC
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── withdrawal-admin-api.md
├── checklists/
│   └── requirements.md  # Đã có
└── tasks.md             # /speckit-tasks sinh ra
```

### Source Code (repository root)

```text
src/routes/withdrawal/
├── admin-withdrawal.controller.ts      # MỚI — 4 route duyệt đơn
├── admin-withdrawal.service.ts         # MỚI — duyệt / từ chối / đánh dấu chi / danh sách
├── withdrawal.repo.ts                  # SỬA — 3 hàm đổi trạng thái + 1 hàm danh sách admin
├── withdrawal.model.ts                 # SỬA — schema input/output cho admin
├── withdrawal.dto.ts                   # SỬA — DTO tương ứng
├── withdrawal.error.ts                 # SỬA — exception mới
└── withdrawal.module.ts                # SỬA — đăng ký controller + service mới

src/routes/wallet/
├── admin-wallet.controller.ts          # SỬA — thêm 3 route đọc vào controller đã có
├── admin-wallet.service.ts             # MỚI — đọc sổ cái, ví một người, đối soát
├── wallet.repo.ts                      # SỬA — truy vấn sổ cái có lọc, phân tách nguồn, đối soát
├── wallet.model.ts                     # SỬA — schema cho ba output mới
├── wallet.dto.ts                       # SỬA — DTO tương ứng
├── wallet.error.ts                      # SỬA — exception không tìm thấy người dùng
├── wallet-core.module.ts               # SỬA — export AdminWalletService
└── wallet.module.ts                    # SỬA — đăng ký service mới

src/shared/constants/withdrawal.constant.ts  # SỬA — trần phân trang cho danh sách admin
docs/deployment-runbook.md                   # SỬA — mục deploy spec 013
```

**Structure Decision**: hai controller quản trị đặt vào **module đã có** của chính miền dữ liệu
chúng đụng tới — `admin-withdrawal.*` vào `withdrawal/`, các route đọc sổ cái vào
`admin-wallet.controller.ts` sẵn có. Đây đúng khuôn repo đang dùng: `admin-wallet.controller.ts`
nằm trong `wallet/`, `admin-entitlement.controller.ts` nằm trong `entitlement/`. Dựng một module
`admin/` riêng sẽ tách controller khỏi repo và service mà nó phụ thuộc, không được lợi gì.

`AdminWalletService` phải được `wallet-core.module.ts` export, vì `WalletModule` chỉ mang
controller — cùng cách `WalletService` đang đi.
