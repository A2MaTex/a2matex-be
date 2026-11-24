# Implementation Plan: Chia tiền bán hàng giữa sàn và nhà phát hành

**Branch**: `feat/commission-split` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/010-commission-split/spec.md`

**Artifacts**: [research.md](./research.md) · [data-model.md](./data-model.md) ·
[contracts/commission-split-api.md](./contracts/commission-split-api.md) · [quickstart.md](./quickstart.md)

## Summary

Chia số tiền mỗi đơn hàng thành phần sàn giữ và phần nhà phát hành nhận, cộng ngay vào ví nhà phát
hành trong chính giao dịch mua, và đóng băng con số đã chia lên từng đơn để đổi tỉ lệ về sau không
rẽ lại lịch sử. Kèm màn doanh thu cho nhà phát hành.

Hướng kỹ thuật, chốt sau khi đối chiếu mã nguồn và dữ liệu production trong [research.md](./research.md):

- Lấy nhà phát hành **ngay trong câu khoá Product** đã có, không thêm vòng truy vấn (R1).
- **Mở rộng** thứ tự khoá hiện tại bằng cách sắp hai dòng ví theo `userId` tăng dần (R2); chặn tự
  mua là thứ bảo đảm hai ví luôn khác nhau (R6).
- Số nguyên `BigInt`, phần nhà phát hành tính bằng **phép trừ** để tổng luôn khớp tuyệt đối (R3).
- Đọc tỉ lệ qua `SystemSettingCoreModule` của phase 1 (R4).
- Màn doanh thu dùng **`@SkipPermissionCheck()`**, không dùng permission riêng cho PUBLISHER — quyết
  định rút từ sự cố 403 ngày hôm nay (R7).
- Migration ba bước trong một file: thêm cột nullable → điền dữ liệu cũ → siết NOT NULL + ràng buộc
  (R9).

## Technical Context

**Language/Version**: TypeScript 6.0 trên Node >= 22, ESM, dev bằng `tsx`, build bằng `tsc`

**Primary Dependencies**: NestJS 11.2, Prisma 7.10 (SQL-first migration), `nestjs-zod` 5.5 + Zod 4.6

**Storage**: PostgreSQL (Cloud SQL `a2matex_dev` cho `staging`; local qua `npm run compose-up`).
Thêm 4 cột vào bảng đơn hàng, không có bảng mới.

**Testing**: vitest (`npm test`). Verify thủ công theo [quickstart.md](./quickstart.md) trên
database local, chạy bản `dist` chứ không phải `start:dev`.

**Target Platform**: container Linux trên GCP VM. Chỉ tiến trình API đụng tới đường code này; cron
và consumer không tạo đơn hàng.

**Project Type**: web service (REST API), module hoá theo `src/routes/<name>/`

**Performance Goals**: thêm đúng **một** lần đọc cấu hình và **một** câu cộng ví vào mỗi giao dịch
mua. Màn doanh thu đi theo index `(publisherUserId, createdAt DESC)`.

**Constraints**:
- Tổng hai phần phải khớp tuyệt đối với giá bán ở mọi đường ghi, kể cả SQL trực tiếp (FR-002).
- Hai giao dịch đồng thời đụng cùng cặp ví không được kẹt nhau (FR-008).
- Mọi đơn hàng cũ phải có đủ thông tin chia tiền sau khi triển khai (FR-016), và đơn tự mua cũ
  không được chia (FR-016b).
- Màn doanh thu không được 403 với nhà phát hành ngay sau deploy.

**Scale/Scope**: 5 đơn hàng trên production. 4 cột mới, 2 route mới, sửa 1 service có sẵn.

## Constitution Check

*GATE: phải pass trước Phase 0. Đã re-check sau Phase 1 — kết quả ở cuối mục.*

| Nguyên tắc | Áp dụng | Trạng thái |
|-----------|---------|-----------|
| **I — Ranh giới xác thực bằng Zod** | Tỉ lệ đọc từ kho cấu hình, không nhận từ client (FR-005); thiếu cấu hình thì từ chối đơn chứ không mặc định (FR-004). DTO ra/vào dùng `createZodDto`. | **PASS** |
| **II — Route nào permission nấy** | Hai route mới nằm sau `AccessTokenGuard`. `npm run seed:permissions` tự tạo bản ghi và xoá cache. R7 chọn `@SkipPermissionCheck()` **chính vì** repo chưa seed được quyền cho role không phải ADMIN — tránh lặp sự cố 403 hôm nay. | **PASS** |
| **III — Migration đi trước** | Một migration SQL-first, ba bước trong một file (R9), áp dụng sạch trên database rỗng. Mang theo chuyển đổi dữ liệu nên phải review như data migration. | **PASS** |
| **IV — Cổng chất lượng** | `npm run lint`, `npm test`, `npm run build` pass trước khi mở PR. **Và `docker build`** — xem Rủi ro. | **PASS** |
| **V — Quyết định phải có spec** | Spec 010 là cổng cho việc tiền bắt đầu chạy vào ví nhà phát hành. Cách xử lý 3 đơn cũ còn mở, đã ghi ở Assumptions đúng theo nguyên tắc. | **PASS** |
| **VI — YAGNI** | Không bảng tổng hợp sẵn (R8), không tài khoản ví riêng cho sàn, không cache tỉ lệ (R4). Việc sắp thứ tự khoá là bắt buộc vì lý do cụ thể, không phải phòng xa. | **PASS** |

**Re-check sau Phase 1**: không phát sinh vi phạm. Complexity Tracking để trống.

## Project Structure

### Documentation (this feature)

```text
specs/010-commission-split/
├── spec.md
├── plan.md                              # file này
├── research.md                          # Phase 0 — 8 giả định đối chiếu + 10 quyết định
├── data-model.md                        # Phase 1
├── quickstart.md                        # Phase 1
├── contracts/
│   └── commission-split-api.md          # Phase 1
├── checklists/requirements.md
└── tasks.md                             # do /speckit-tasks sinh
```

### Source Code (repository root)

```text
src/
├── routes/order/
│   ├── order.repo.ts                    # SỬA — JOIN publisher vào lockProduct, khoá 2 ví, cộng ví, cột split
│   ├── order.service.ts                 # SỬA — đọc tỉ lệ, tính split, thứ tự khoá, chặn tự mua
│   ├── order.error.ts                   # SỬA — lỗi tự mua, lỗi thiếu cấu hình hoa hồng, lỗi ví publisher
│   ├── order.model.ts                   # SỬA — 4 trường split trên output
│   └── order.module.ts                  # SỬA — import SystemSettingCoreModule
├── routes/publisher-earning/            # MỚI
│   ├── publisher-earning.controller.ts  # 2 route, @SkipPermissionCheck()
│   ├── publisher-earning.dto.ts
│   ├── publisher-earning.model.ts
│   ├── publisher-earning.module.ts
│   ├── publisher-earning.repo.ts
│   ├── publisher-earning.service.ts
│   └── test/
│       ├── commission-split.spec.ts     # số học chia tiền: biên, phần dư, tổng luôn khớp
│       ├── publisher-earning.repo.spec.ts
│       └── publisher-earning.service.spec.ts
├── routes/order/test/                   # MỚI — đã kiểm: src/routes/order/ chưa có test nào, không vỡ gì
│   └── order-split.service.spec.ts      # chặn tự mua, thiếu cấu hình, thứ tự khoá, giá 0
├── entities/order.model.ts              # SỬA — 4 trường split
├── shared/constants/order.constant.ts   # SỬA — hằng số đơn vị basis point nếu cần dùng chung
└── app.module.ts                        # SỬA — import PublisherEarningModule

prisma/
├── schema.prisma                        # SỬA — qua quy trình migration
└── migrations/<timestamp>_add_order_revenue_split/   # MỚI — 3 bước, kèm chuyển đổi dữ liệu
```

**Structure Decision**: giữ nguyên quy ước `src/routes/<name>/`. Màn doanh thu tách thành module
riêng `publisher-earning` thay vì nhét vào `order`, vì nó là **đường đọc của một vai trò khác**
(người bán) trên cùng dữ liệu, với mô hình phân quyền khác (R7). Nhét chung sẽ làm `OrderModule`
phục vụ hai vai trò với hai luật truy cập trong cùng một controller.

Việc chia tiền **không** tách module: nó là một phần của chính giao dịch mua và không có nghĩa khi
đứng riêng.

## Thứ tự triển khai

| Bước | Nội dung | Vì sao ở vị trí này |
|------|----------|---------------------|
| 1 | Migration 3 bước + `schema.prisma` + `prisma:generate` + entity | Mọi thứ khác đọc 4 cột này. Quên `prisma:generate` thì `npm run build` fail TS2694 |
| 2 | Hàm tính split + test số học | Thuần tuý, không phụ thuộc gì, và là chỗ sai thì sai âm thầm. Test phải là **bất biến quét nhiều giá trị** (`commission + publisher === total` với hàng loạt cặp giá/tỉ lệ), không phải vài phép so sánh với giá trị mẫu — bảng giá trị ở data-model chứng minh số nguyên *đúng*, chứ không chứng minh cài đặt *là* số nguyên; chỉ bất biến mới gãy ngay với bản dùng số thực hoặc nhân hai lần |
| 3 | `order.repo.ts`: JOIN publisher, khoá 2 ví, cộng ví, ghi 4 cột | Cần migration xong |
| 4 | `order.service.ts`: đọc tỉ lệ, chặn tự mua, ghép thứ tự khoá | Cần repo và `SystemSettingCoreModule` |

**Thứ tự ghi bên trong giao dịch mua** — bắt buộc, không phải tuỳ ý:

```text
khoá Product (kèm publisher) → khoá Offer → chặn tự mua
→ khoá 2 ví theo userId tăng dần → khoá Entitlement
→ kiểm số dư khách → TRỪ ví khách → CỘNG ví publisher
→ tạo đơn (ghi 4 cột split) → cấp quyền
```

Cộng ví nhà phát hành nằm **sau** bước kiểm số dư và trừ ví khách. Đặt trước thì đơn thất bại vì
khách không đủ tiền vẫn kịp ghi vào ví nhà phát hành rồi mới quay lui; quickstart §4 kiểm điểm này.

Xác định nhà phát hành là **vô điều kiện** (cột `publisherUserId` NOT NULL), chỉ việc **khoá và
cộng ví** của họ mới bỏ qua khi phần nhận bằng 0.
| 5 | `order.module.ts` import core module + lỗi domain | Cùng nhóm với bước 4 |
| 6 | Test cho đường mua: tự mua, thiếu cấu hình, giá 0 | Nguyên tắc IV |
| 7 | Module `publisher-earning` + 2 route + test | Độc lập với bước 3–6, chỉ cần 4 cột ở bước 1 |
| 8 | `seed:permissions`, kiểm cache đã xoá | Cần controller tồn tại |
| 9 | Verify trọn quickstart trên database local, bản `dist` | Nguyên tắc IV |
| 10 | `docker build` | Xem Rủi ro |

## Rủi ro và cách xử lý

| Rủi ro | Xử lý |
|--------|-------|
| Hai nhà phát hành mua chéo nhau cùng lúc gây kẹt | Sắp hai ví theo `userId` tăng dần (R2); quickstart có kịch bản chạy thật hai chiều |
| Tổng hai phần lệch giá bán | Tính phần nhà phát hành bằng phép trừ (R3) **và** ràng buộc ở tầng dữ liệu; test số học quét các mức giá không chia hết |
| Màn doanh thu 403 với nhà phát hành ngay sau deploy | `@SkipPermissionCheck()` (R7), không phụ thuộc seed quyền cho role không phải ADMIN |
| Quên `await` khi thêm bước bất đồng bộ vào giao dịch | `oxlint --type-aware` bật `typescript/no-floating-promises` ở mức lỗi |
| **`docker build` đang hỏng vì xung đột `cron`** | Đã ghim `cron 4.4.0` ở PR #48, nhánh này nhánh con của `staging` nên thừa hưởng. Vẫn phải chạy `docker build` trước khi merge: `npm run build` ở local **không** chứng minh được image build được |
| Chuyển đổi dữ liệu cũ chia nhầm tiền | Đã chốt: cả 5 đơn là giao dịch thử, ghi toàn bộ về sàn, **không có câu `UPDATE "Profile"` nào** trong migration (R10) |

## Complexity Tracking

Không có vi phạm constitution nào cần biện minh.
