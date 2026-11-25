# Implementation Plan: Sổ cái ví và tài khoản tiền của sàn

**Branch**: `feat/wallet-ledger` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/011-wallet-ledger/spec.md`

**Artifacts**: [research.md](./research.md) · [data-model.md](./data-model.md) ·
[contracts/wallet-ledger-api.md](./contracts/wallet-ledger-api.md) · [quickstart.md](./quickstart.md)

## Summary

Mỗi lần số dư đổi để lại đúng một bút toán nói rõ vì sao và còn lại bao nhiêu. Tiền của sàn có một
tài khoản riêng, nhận hoa hồng từ mỗi đơn và là nguồn duy nhất cho việc quản trị viên cộng tiền.

Hướng kỹ thuật, chốt sau khi đối chiếu mã nguồn và dữ liệu production ([research.md](./research.md)):

- Bốn chỗ ghi số dư dùng **`updateManyAndReturn`** để lấy số dư ngay từ thao tác đã đổi nó (R1) —
  Prisma 7 có sẵn, repo đã dùng ở `project-draft.repo.ts:108`.
- Bút toán của đơn ghi **sau khi tạo đơn**, vì cả ba phải trỏ tới đơn (R3).
- Tiền của sàn ở **bảng riêng** `SystemAccount`, không phải một tài khoản người dùng giả (R4) —
  tránh lỗ xoá mềm trong phép đối soát.
- Quản trị viên cộng tiền là **chuyển khoản hai chân** nối bằng `transferId` (R5).
- **Bỏ `OPENING_BALANCE`**, thay bằng bước dọn dữ liệu chạy riêng trước migration (R7).
- Backfill nằm **trong migration**, có chốt chặn chạy trùng **và hai chốt dừng** (R8).
- Chốt chặn tiền của `ADMIN_GRANT` nằm ở **conditional update**, không phải ở `CHECK` (R12) — để
  "ví sàn không đủ tiền" trả 422 chứ không phải 500.
- Đối soát là **truy vấn trong runbook**, không dựng API (R10).

## Technical Context

**Language/Version**: TypeScript 6.0 trên Node >= 22, ESM, dev bằng `tsx`, build bằng `tsc`

**Primary Dependencies**: NestJS 11.2, Prisma 7.10 (SQL-first migration), `nestjs-zod` 5.5 + Zod 4.6

**Storage**: PostgreSQL (Cloud SQL cho `staging`; local qua `npm run compose-up`). **Hai bảng
mới**, không bảng nào đang có bị đổi cấu trúc — `Profile` chỉ nhận thêm một ràng buộc.

**Testing**: vitest cho phần tính toán thuần (không commit, theo R15). Verify chính thức theo
[quickstart.md](./quickstart.md) trên database local, chạy bản `dist` chứ không phải `start:dev`.

**Target Platform**: container Linux trên GCP VM. Chỉ tiến trình API đụng tới các đường ghi số dư;
cron và consumer không đụng.

**Project Type**: web service (NestJS, module hoá theo `src/routes/`)

**Performance Goals**: thêm tối đa **ba** câu ghi cho mỗi lần mua hàng, **hai** cho mỗi lần quản
trị viên cộng tiền, **một** cho mỗi lần nạp. Lịch sử ví đọc theo index `(chủ ví, thời điểm giảm
dần)`.

**Constraints**:

- Ghi sổ và đổi số dư cùng thành công hoặc cùng không (FR-006), áp dụng cho **cả hai chân** của một
  lần chuyển khoản.
- Số dư **không bao giờ âm** (FR-009) ở cả ba chỗ: ví người dùng, tài khoản của sàn, số dư-sau.
- Ví sàn không đủ tiền PHẢI là lỗi nghiệp vụ **422**, không phải 500 (FR-035).
- `ADMIN_GRANT` và `ISSUED_CREDIT` phải ghi người thực hiện và lý do (FR-036, FR-043).
- Backfill chạy lại không nhân đôi (FR-023), và **dừng to tiếng** nếu còn lệch (FR-021).
- Sau khi dựng lại, **100%** tài khoản có tổng lịch sử bằng số dư thật (SC-001).

**Scale/Scope**: production có 10 ví, 7 đơn, 6 lần nạp → backfill sinh **khoảng 20 bút toán**, kể cả 5 bút toán ghi lại khoản quản trị viên đã cấp.
Hai bảng mới, ba route mới, sửa 2 service có sẵn.

## Constitution Check

*GATE: phải pass trước Phase 0. Đã re-check sau Phase 1 — kết quả ở cuối mục.*

| Nguyên tắc | Áp dụng | Trạng thái |
|-----------|---------|-----------|
| **I — Ranh giới xác thực bằng Zod** | Lịch sử ví lọc theo người đang đăng nhập, không nhận tham số id từ client (FR-025). Ba DTO mới dùng `createZodDto`; số tiền nhận dạng chuỗi thập phân rồi parse sang `BigInt`, không đi qua `number`. | **PASS** |
| **II — Route nào permission nấy** | Hai route quản trị có permission **riêng cho từng route** — bơm tiền là việc hiếm làm tăng nợ ảo, cộng tiền là việc thường xuyên và luôn có nguồn, nên không dùng chung quyền. Seed trong cùng PR, cache được xoá. Route lịch sử dùng `@SkipPermissionCheck()` **vì** repo chưa seed được quyền cho role non-ADMIN (R13) — vẫn nằm sau `AccessTokenGuard`. | **PASS** |
| **III — Migration đi trước** | Một migration SQL-first mang theo cả việc dựng lịch sử, áp dụng sạch trên database rỗng, và **chạy lại được** (R8). Riêng production có một bước ghi lại chạy ngoài repo. | **PASS có ngoại lệ** — xem Complexity Tracking |
| **IV — Cổng chất lượng** | `lint`, `test`, `build` **và `docker build`** pass trước khi mở PR — xem Rủi ro. | **PASS** |
| **V — Quyết định phải có spec** | Spec 011 là cổng cho việc dựng sổ cái tiền. Mọi quyết định đảo chiều (bỏ `OPENING_BALANCE`, bảng riêng cho tiền của sàn, một loại `ISSUED_CREDIT`, dọn dữ liệu dù tài khoản còn dùng) đều đã chốt trực tiếp với chủ repo và ghi trong mục Clarifications. | **PASS** |
| **VI — YAGNI** | `SystemAccountType` ship với **đúng một** giá trị; không API đối soát (R10); không cảnh báo tự động; không xuất tệp; không lọc thời gian; không tách `CAPITAL_INJECTION` (R6). Hai bảng mới là bắt buộc chứ không phải trừu tượng hoá sớm — không có chúng thì hoa hồng không có chỗ đứng và sổ cái không cân. | **PASS** |

**Re-check sau Phase 1**: không phát sinh vi phạm mới. Ngoại lệ ở Nguyên tắc III đã có ở Phase 0 và
được ghi lại đầy đủ bên dưới.

## Project Structure

### Documentation (this feature)

```text
specs/011-wallet-ledger/
├── spec.md                              # 46 FR, 12 SC, 6 user story
├── plan.md                              # file này
├── research.md                          # Phase 0 — 10 giả định đối chiếu + 15 quyết định
├── data-model.md                        # Phase 1
├── quickstart.md                        # Phase 1
├── contracts/
│   └── wallet-ledger-api.md             # Phase 1 — 3 route
├── checklists/requirements.md
└── tasks.md                             # do /speckit-tasks sinh
```

### Source Code (repository root)

```text
src/
├── routes/wallet/                       # MỚI
│   ├── wallet.controller.ts             # lịch sử ví, @SkipPermissionCheck()
│   ├── admin-wallet.controller.ts       # cộng tiền + bơm ví sàn, permission riêng từng route
│   ├── wallet.dto.ts
│   ├── wallet.error.ts                  # lỗi "ví sàn không đủ tiền" → 422
│   ├── wallet.model.ts
│   ├── wallet.module.ts                 # CÓ controller
│   ├── wallet-core.module.ts            # KHÔNG controller — topup/order import cái này
│   ├── wallet.repo.ts                   # ghi bút toán, đọc lịch sử, đổi số dư tài khoản sàn
│   └── wallet.service.ts                # ghi sổ cho module khác + 3 luồng của riêng nó
├── routes/topup/
│   ├── topup.repo.ts                    # SỬA — trả thêm số dư sau khi cộng
│   ├── topup.service.ts                 # SỬA — ghi bút toán nạp tiền trong creditTopUp
│   └── topup-core.module.ts             # SỬA — import WalletCoreModule
├── routes/order/
│   ├── order.repo.ts                    # SỬA — debitBalance + creditPublisherBalance
│   │                                    #        dùng updateManyAndReturn
│   ├── order.service.ts                 # SỬA — cộng ví sàn + ghi 3 bút toán sau khi tạo đơn
│   └── order.module.ts                  # SỬA — import WalletCoreModule
├── entities/wallet-transaction.model.ts # MỚI
├── entities/system-account.model.ts     # MỚI
├── shared/constants/wallet.constant.ts  # MỚI — loại bút toán, chiều, loại tài khoản hệ thống
├── seed/create-permissions.ts           # SỬA — 2 permission mới
└── app.module.ts                        # SỬA — import WalletModule

prisma/
├── schema.prisma                        # SỬA — qua quy trình migration
└── migrations/<timestamp>_add_wallet_ledger/   # MỚI — 2 bảng + 3 enum + dựng lịch sử

docs/deployment-runbook.md               # SỬA — 5 truy vấn đối soát + mục B9

# KHÔNG có file mã nguồn nào cho việc dọn dữ liệu, vì KHÔNG CÒN bước dọn nào: migration
# tự ghi lại khoản quản trị viên đã cấp (bước B5). Đảo quyết định 2026-11-25.
```

**Structure Decision**: tách **`WalletCoreModule`** (không controller) và **`WalletModule`** (có
controller), đúng mô hình đã dùng ở phase 1 cho `SystemSetting`
(`src/routes/system-setting/system-setting-core.module.ts`). Lý do bắt buộc: `TopUpCoreModule` phải
import đường ghi sổ, mà `TopUpCoreModule` **đang được `CronModule` import** — module có controller
lọt vào đó sẽ làm route lịch sử ví lộ ra trên cổng cron server.

## Thứ tự triển khai

| Bước | Nội dung | Vì sao ở vị trí này |
|------|----------|---------------------|
| 1 | Migration tạo 2 bảng + 3 enum + `schema.prisma` + `prisma:generate` + entity + hằng số | Mọi thứ khác đọc từ đây |
| 2 | Phần dựng lịch sử **trong cùng file migration**, kèm chốt chặn chạy trùng và 2 chốt dừng | Cùng file để không có cửa sổ bảng-có-mà-lịch-sử-chưa |
| 3 | `wallet.repo.ts` + `wallet.service.ts` + `wallet-core.module.ts` | Lõi ghi sổ, chưa lộ HTTP |
| 4 | Bốn chỗ ghi số dư đổi sang trả về số dư | Cần trước khi ghi sổ được |
| 5 | Ghi bút toán ở `topup.service.ts`; cộng ví sàn + ghi 3 bút toán ở `order.service.ts` | Cần bước 3 và 4 |
| 6 | Ba luồng riêng của wallet: lịch sử, cộng tiền hai chân, bơm ví sàn | Cần bước 3 |
| 7 | Controller + DTO + lỗi 422 + module + `app.module.ts` | Độc lập với bước 4-5 |
| 8 | `seed:permissions` — 2 permission mới | Cần controller tồn tại |
| 9 | `prod-apply.local.sql`: migration + bước ghi lại, chạy tay một lần trên production. **Không vào git** | Phải sau B1–B4 (tính chênh từ sổ cái) và trước hai chốt dừng, nên không tách ra được |
| 10 | Verify quickstart trên database local, bản `dist` | Nguyên tắc IV |
| 11 | `docker build` | Xem Rủi ro |
| 12 | Runbook: 5 truy vấn đối soát, mục B9 | Hoàn tất |

**Thứ tự ghi trong giao dịch mua** — bắt buộc, không tuỳ ý:

```text
1. Khoá Profile khách, so số dư            (giữ nguyên như hiện tại)
2. Trừ ví khách                            → số dư khách
3. Cộng ví nhà phát hành (nếu > 0)         → số dư publisher
4. Cộng tài khoản của sàn (nếu > 0)        → số dư ví sàn
5. Tạo đơn                                 → orderId
6. Ghi PURCHASE + EARNING + COMMISSION     (phải sau bước 5 vì cần orderId)
7. Kích hoạt entitlement
```

Bước 2 trước bước 3 và 4 là bắt buộc: một đơn thất bại vì khách thiếu tiền **không được** chạm vào
ví nhà phát hành hay tài khoản của sàn trước. Comment hiện có ở `order.service.ts:257` đã nói đúng
điều này cho bước 3; bước 4 thừa hưởng cùng lý do.

**Thứ tự ghi trong lần quản trị viên cộng tiền**:

```text
1. Validate đầu vào, kiểm người nhận tồn tại và chưa xoá
2. Sinh transferId
3. Trừ tài khoản của sàn — conditional update, guard `balance >= amount`
   → 0 dòng = ví sàn không đủ → ném lỗi nghiệp vụ 422, KHÔNG phải lỗi hệ thống
4. Cộng ví người nhận
5. Ghi 2 bút toán cùng transferId
```

Bước 3 trước bước 4: nếu cộng cho người nhận trước rồi mới phát hiện ví sàn thiếu, transaction sẽ
rollback — đúng, nhưng tốn một vòng và làm log khó đọc. Kiểm nguồn trước khi trả là thứ tự tự nhiên.

## Complexity Tracking

| Vi phạm | Vì sao cần | Phương án đơn giản hơn bị bác bỏ vì |
|---------|-----------|-------------------------------------|
| **Nguyên tắc III** — một bước có tác động dữ liệu (ghi lại 15.994.000 ₫ quản trị viên đã cấp cho hai ví) được áp lên production **ngoài file migration đã commit**, qua `prod-apply.local.sql` | Bước đó phải hardcode UUID của **hai người dùng thật** và của tài khoản quản trị viên production. Đưa vào repo là commit vĩnh viễn định danh người dùng vào mã nguồn, trong một file mà mọi môi trường khác không bao giờ cần tới. Nó chỉ chạy **một lần**, rồi `migrate resolve --applied` đánh dấu xong | **Để B5 trong migration** (bản 2026-11-25 sáng): đưa UUID người dùng thật vào git vĩnh viễn, và làm bẩn một file mà database rỗng không bao giờ dùng tới. **Xoá dữ liệu của hai ví** (bản 2026-11-24): phá huỷ 6 quyền truy cập còn hiệu lực và 6.000 ₫ tiền nạp thật của người dùng thật. **Tách B5 chạy riêng**: không chạy được — B5 cần bảng đã tồn tại nhưng phải chạy trước hai chốt dừng, nên không có khe nào để chen vào giữa |

Lịch sử đảo chiều của mục này: 2026-11-24 ngoại lệ là "xoá dữ liệu production" → 2026-11-25 sáng
"không còn ngoại lệ nào" → 2026-11-25 chiều ngoại lệ hẹp hơn hẳn: **không xoá gì, chỉ là bước ghi
lại nằm ngoài repo**. Mỗi lần đảo đều do đối chiếu dữ liệu thật, ghi ở mục Clarifications của
[spec.md](./spec.md).

## Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| **`docker build` đỏ dù `npm run build` xanh** | Đã xảy ra: build local không chứng minh gì về image vì khác cách giải phụ thuộc. `docker build` là cổng bắt buộc ở bước 11, không phải kiểm tuỳ chọn |
| **Có ví lệch ngoài danh sách ở B5, migration dừng** | Đúng như thiết kế. Đọc danh sách migration in ra, xác định vì sao ví đó lệch, rồi quyết định — **không** thêm bừa vào danh sách B5 để nó đi qua |
| **Ví sàn không đủ tiền trả 500 thay vì 422** | Chốt chặn phải ở conditional update (R12), `CHECK` chỉ là lưới cuối. Quickstart mục 4a kiểm đúng việc này, và kiểm **trước** đường thành công |
| **Verify trên `start:dev` bỏ lọt lỗi validate** | `tsx` không emit decorator metadata nên DTO không được validate. Quickstart bắt chạy `dist`, và nói rõ mục 4b sẽ đi qua hết nếu chạy sai |
| **Deploy gãy giữa chừng, migration xong mà app chưa lên** | Đã xảy ra. Backfill có chốt chặn chạy trùng nên `migrate deploy` chạy lại an toàn; phục hồi bằng `compose up -d`, không cần rollback |
| **Permission mới chưa seed → 403 cho cả admin** | Seed đi cùng PR (Nguyên tắc II), và phải xoá cache role-permission sau khi seed |
| **Cam kết "không dùng `ISSUED_CREDIT` cho tiền nạp thật" bị phá** | Không có gì trong hệ thống ép. Đã ghi ở Assumptions của spec và ở R6; ngày nào nghiệp vụ đó phát sinh phải tách loại **trước khi** dùng |
