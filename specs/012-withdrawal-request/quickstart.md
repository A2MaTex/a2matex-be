# Quickstart: Verify đơn rút tiền cho nhà phát hành

**Phase 1** · 2026-11-27 · [contracts/withdrawal-api.md](./contracts/withdrawal-api.md)

Hướng dẫn chạy và kiểm chứng. **Không** chứa mã hiện thực — phần đó ở `tasks.md`.

---

## Hai điều bắt buộc trước khi bắt đầu

**1. Chạy trên `dist`, KHÔNG dùng `npm run start:dev`.**
`tsx` không emit decorator metadata nên DTO **không được validate** — mọi bài kiểm input dưới đây
sẽ cho qua sai. Luôn `npm run build && node dist/main.js`.

**2. Viết và chạy unit test, nhưng KHÔNG commit.**
Test chạy tốt ở local vì `.env` đầy đủ; CI không có `.env` nên `config.ts` gọi `process.exit(1)` và
**giết CI trước khi image được build** (commit `5b69ebd`). Đặt test ở `src/routes/withdrawal/test/`
và thêm dòng này vào `.gitignore`:

```gitignore
# Unit test module tiền: chạy ở local, không lên CI (xem research.md R11)
src/routes/withdrawal/test/
```

Kiểm trước khi mở PR: `git status --short` **không** được liệt kê file test nào.

---

## Chuẩn bị môi trường

```bash
docker compose -f tools/docker-compose.yaml up -d postgres redis
npm run prisma:generate
npm run prisma:migrate:deploy
npm run seed:roles && npm run seed:permissions && npm run seed:settings
npm run build && node dist/main.js
```

Kiểm DB local khớp schema — phải in ra `No difference detected`:

```bash
PW=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2- | tr -d "'\"")
DATABASE_URL="postgresql://a2matex_dev:$PW@localhost:5432/a2matex_dev?schema=public" \
  npx prisma migrate diff --from-config-datasource \
  --to-schema prisma/schema.prisma --config prisma7.config.ts
```

> `.env` có **hai** biến trỏ hai nơi khác nhau: `POSTGRES_HOST=db.a2matex.com` (Cloud SQL) còn
> `DATABASE_URL` trỏ `localhost`. Đừng nhầm — chạy verify nhầm lên Cloud SQL là chạm dữ liệu thật.

---

## Dựng dữ liệu thử

DB local sau khi reset chỉ còn 1 profile admin và 0 sản phẩm. Tạo số dư bằng `ADMIN_GRANT` thay vì
dựng publisher + sản phẩm + offer + người mua — FR-004 nói rõ nguồn tiền không quan trọng.

1. Đăng nhập admin (`no-reply@a2matex.com`). Trường đăng nhập tên là **`account`**, không phải `email`.
2. Bơm ví sàn: `POST /admin/system-account/issue-credit`.
   **Bắt buộc làm trước** — `grantToUser` là một lần *chuyển khoản*, ví sàn rỗng thì trả 422.
3. Tạo một tài khoản nhà phát hành đang hoạt động (có `PublisherAccount`, đã ký `PUBLISHER_TERMS`).
4. Cộng tiền cho nhà phát hành đó: `POST /admin/wallet-transactions/grant`.

---

## Kịch bản kiểm — luồng chính

| # | Việc làm | Kết quả phải thấy | FR |
|---|---|---|---|
| 1 | Publisher số dư 500.000, tạo đơn rút 200.000 | 200, `status=PENDING`, `balanceAfter="300000"` | 005, SC-001 |
| 2 | Kiểm `Profile.balance` trong DB | đúng `300000` | 005 |
| 3 | Kiểm `WalletTransaction` | đúng **1** dòng `WITHDRAWAL/DEBIT`, `balanceAfter=300000`, có `withdrawalRequestId` | 028 |
| 4 | `GET /withdrawals/me` | thấy đơn vừa tạo, khoá là `items` | US2 |
| 5 | `GET /withdrawals/:id` | trả đúng đơn | US2 |
| 6 | Huỷ đơn | 200, `status=CANCELLED`, `balanceAfter="500000"` | 023, 024 |
| 7 | Kiểm sổ cái lại | thêm **1** dòng `WITHDRAWAL_REVERSAL/CREDIT`, tổng 2 dòng cho đơn đó | 029 |

---

## Kịch bản kiểm — các đường từ chối

Mỗi ca **phải** trả đúng mã nghiệp vụ, **không ca nào được là 500** (SC-009).

| # | Việc làm | Phải thấy | FR |
|---|---|---|---|
| 8 | Rút nhiều hơn số dư | 422 `InsufficientBalance`, số dư **không đổi**, **0 bút toán** | 006, 008 |
| 9 | Rút 50.000 (dưới mức tối thiểu) | 422 `BelowMinimum`, số dư không đổi | 010 |
| 10 | Rút `"0"` và `"-1"` | 422 `AmountInvalid`, chặn ở tầng DTO | Edge |
| 11 | Rút `"9999999999999999999"` (vượt trần BIGINT) | **422**, KHÔNG phải 500 | Edge, R5 |
| 12 | Tạo đơn thứ hai ngay sau đơn đầu | 422 `CooldownActive`, **có nêu thời điểm sớm nhất** | 013, 015 |
| 13 | Huỷ đơn đầu rồi tạo đơn mới | **vẫn** 422 `CooldownActive` | 014 |
| 14 | Người dùng thường (không publisher) tạo đơn | 403 `PublisherNotActivated`, số dư không đổi | 001 |
| 15 | Publisher bị khoá tạo đơn | 403 `PublisherBlocked` | 003 |
| 16 | Publisher B xem đơn của A | 404 `WithdrawalNotFound` — **giống hệt** id không tồn tại | 036 |
| 17 | Publisher B huỷ đơn của A | 404, đơn của A **không đổi** | 036 |
| 18 | Huỷ một đơn đã `CANCELLED` | 409 `NotPending`, **số dư không cộng lần hai** | 025, 026 |
| 19 | Xoá khoá `WITHDRAWAL_MIN_AMOUNT` khỏi DB rồi tạo đơn | 503 `MinAmountUnavailable` | 012 |

---

## Kịch bản kiểm — chạy song song (SC-003, SC-004)

Gửi đồng thời bằng `&` trong shell hoặc `xargs -P`.

| # | Việc làm | Phải thấy |
|---|---|---|
| 20 | 10 lệnh tạo đơn cùng lúc, số dư chỉ đủ cho 1 | **đúng 1** thành công, 9 lệnh còn lại 422; số dư **không bao giờ** âm |
| 21 | 2 lệnh tạo đơn cùng lúc, cả hai đều qua mốc 24 giờ | **đúng 1** thành công |
| 22 | 2 lệnh huỷ cùng một đơn, cùng lúc | **đúng 1** hoàn tiền; lệnh kia **409**, KHÔNG phải 500 |
| 23 | 2 lệnh tạo đơn cùng `Idempotency-Key`, cùng lúc | cả hai trả **cùng một** đơn; số dư trừ **một lần**; sổ cái **một** dòng |

> Ca 22 giờ **không thể sai nếu làm đúng R8**: câu `UPDATE ... WHERE status = 'PENDING'` vừa kiểm
> vừa ghi trong một lệnh, nên không có cửa sổ nào để chen vào. Nếu vẫn nhận 500 nghĩa là ai đó đã
> tách thành `SELECT` rồi `UPDATE` — sửa lại thành một câu lệnh, **đừng** bắt lỗi ràng buộc rồi
> đổi thành 409 (vá triệu chứng, và vẫn hở nếu index bị gỡ).

---

## Kịch bản kiểm — chống lặp

| # | Việc làm | Phải thấy | FR |
|---|---|---|---|
| 24 | Gửi lại **y hệt** cùng `Idempotency-Key` | đơn cũ, số dư trừ một lần, 1 bút toán | 034 |
| 25 | Cùng khoá, **đổi số tiền** | 409 `IdempotencyKeyReused` | 035 |
| 26 | Cùng khoá, **đổi số tài khoản ngân hàng** | 409 `IdempotencyKeyReused` | 035 |
| 27 | Hai publisher khác nhau dùng **trùng** một khoá | cả hai thành công — khoá chỉ duy nhất trong phạm vi từng người | 033 |

> Ca 26 là ca nguy hiểm nhất: im lặng trả về đơn cũ sẽ khiến tiền đi tới tài khoản mà người dùng
> tưởng đã đổi. Chống bằng cách so **cả đối tượng `WithdrawalClaim`** (R4) thay vì so từng trường
> rời rạc — thêm trường mới vào type sẽ làm TypeScript báo lỗi ở mọi chỗ dựng claim.

---

## Kịch bản kiểm — đối soát (SC-002, SC-005, SC-006)

Chạy sau khi đã có vài đơn ở nhiều trạng thái.

| # | Phép kiểm | Phải thấy |
|---|---|---|
| 28 | 4 phép đối soát (a)(b)(c)(d) trong runbook | **0 dòng** mỗi phép |
| 29 | Phép (f) mới — đơn chưa hoàn khớp sổ cái | hai cột bằng nhau |
| 30 | Phép (e) đã cập nhật — đẳng thức hai túi | cân |
| 31 | Tạo một đơn rồi chạy lại (e) | **vẫn cân**: `nợ người dùng` giảm X, `đang chờ chi` tăng X |
| 32 | Huỷ đơn đó rồi chạy lại (e) | **vẫn cân**, quay về số ban đầu |
| 33 | Đổi tay một đơn sang `PAID` rồi chạy lại (e) | **vẫn cân**: cả hai vế cùng giảm X |

Ca 31 là phép kiểm trực tiếp cho SC-006a: **tổng tài sản theo sổ sách không được đổi** khi tạo
đơn, vì tiền mới chỉ rời ví chứ chưa rời công ty.

---

## Trước khi mở PR

- [ ] `npm run lint` xanh
- [ ] `npm test` xanh ở local, bao gồm cả test mới của module này
- [ ] `git status --short` **không** liệt kê file test nào — đã có dòng `.gitignore` chặn
- [ ] `npm run build` xanh — nếu `TS2694 ... has no exported member`, chạy `npm run prisma:generate`
- [ ] `prisma migrate diff` báo `No difference detected`
- [ ] Hai migration áp sạch trên **DB rỗng** (Nguyên tắc III), và áp lại lần hai không nhân đôi gì
- [ ] 33 ca trên đều đạt
- [ ] `docs/deployment-runbook.md` đã có phép (f) và phép (e) bản hai túi
- [ ] Runbook ghi rõ **không cần chạy `seed-permissions`** cho lần deploy này (FR-038a) và vì sao

---

## Lượt kiểm thứ hai (2026-11-27) — 30 ca bổ sung

Lượt đầu chỉ chạy đường HTTP. Lượt này bịt các mảng **chưa từng chạm**, trong đó quan trọng
nhất là toàn bộ ràng buộc tầng database — thứ mà T009/R6 gọi là "bẫy im lặng" vì không test
nào ở tầng ứng dụng phát hiện ra.

| Nhóm | Ca | Kết quả |
|---|---|---|
| A — `source_check` | 4 | mọi nhánh cũ đều từ chối `withdrawalRequestId`; `WITHDRAWAL` thiếu nguồn hoặc mang kèm `orderId` đều bị chặn |
| B — `accountKind_check` | 3 | sai chiều và sai loại tài khoản đều bị chặn |
| C — unique index | 1 | bút toán `WITHDRAWAL` thứ hai cho cùng đơn bị chặn |
| D — ràng buộc đơn | 6 | `amount=0`, `processedAt` lệch trạng thái, `bankTransferRef` khi chưa `PAID`, `rejectionReason` khi chưa `REJECTED`, trùng khoá chống lặp |
| E — cấu hình & ví | 3 | mức tối thiểu `'abc'` / vượt trần BIGINT, và `Profile.balance` âm |
| F — xác thực & header | 4 | 401 không token; 422 thiếu/sai `Idempotency-Key`; 422 id không phải UUID |
| G — phân trang | 3 | `limit=101` và `page=0` đều 422; `limit=100` qua |
| H — admin sửa mức tối thiểu | 3 | `'abc'` và vượt trần đều **422, không 500** — bản vá `refine` đúng cả trên đường admin |
| I — hiệu lực tức thì | 1 | đổi mức tối thiểu có tác dụng ngay ở yêu cầu kế tiếp (không cache) |
| J — nội dung danh sách | 1 | có cả `CANCELLED` và `PAID`; `balanceAfter` **không** lọt vào route đọc |
| K — ranh giới 24 giờ | 2 | 23h59m59s bị chặn, 24h00m01s qua |
| L — hồ sơ xoá mềm | 1 | 404 `WithdrawalProfileNotFound` |
| M — cuộn ngược transaction | 1 | ép lỗi ghi sổ → **số dư không đổi và 0 đơn được tạo** (FR-030) |

Ca M đáng giữ lại nhất: thu hồi quyền `INSERT` trên `WalletTransaction` rồi gọi tạo đơn. Nếu
transaction không bao trọn cả ba việc thì số dư sẽ bị trừ mà không có đơn nào — đây là cách
duy nhất chứng minh FR-030 mà không phải đọc code.
