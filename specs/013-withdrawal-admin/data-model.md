# Data Model: Quản trị viên duyệt đơn rút tiền và xem sổ cái

**Phase 1** · 2026-11-27 · [plan.md](./plan.md) · [research.md](./research.md)

---

## 1. Thay đổi lược đồ: KHÔNG CÓ

Không bảng mới, không cột mới, không enum mới, không ràng buộc mới, **không migration**.

Spec 012 đã khai sẵn mọi thứ spec này cần. Ba ràng buộc nhất quán trạng thái đang ép đúng những
điều FR đòi, nên code phải **viết thuận theo** chúng:

| Ràng buộc đã có | Hệ quả bắt buộc cho code |
|---|---|
| `WithdrawalRequest_processed_check` | mọi câu `UPDATE` rời `PENDING` phải đặt `processedAt` trong **cùng** câu lệnh |
| `WithdrawalRequest_transferRef_check` | chỉ được đặt `bankTransferRef` khi đồng thời đặt trạng thái `PAID` |
| `WithdrawalRequest_rejection_check` | chỉ được đặt `rejectionReason` khi đồng thời đặt trạng thái `REJECTED` |

Đặt sai bộ cột đi kèm sẽ vi phạm ràng buộc và thành lỗi hệ thống — vi phạm FR-039.

---

## 2. Máy trạng thái sau spec này

```
                  ┌──────────► CANCELLED      publisher tự huỷ (spec 012)
                  │
   ──► PENDING ───┼──────────► REJECTED ◄───┐ admin từ chối   ← MỚI
                  │                         │
                  └──► APPROVED ────────────┘ admin từ chối   ← MỚI
                           │
                           └──► PAID           admin đánh dấu  ← MỚI
```

| Chuyển | Ai | Số dư | Bút toán | Cột bắt buộc đặt kèm |
|---|---|---|---|---|
| → `PENDING` | publisher | −X | `WITHDRAWAL` | — |
| `PENDING` → `CANCELLED` | publisher | +X | `WITHDRAWAL_REVERSAL` | `processedAt` |
| `PENDING` → `APPROVED` | **admin** | **không đổi** | **không có** | `processedAt`, `processedById` |
| `APPROVED` → `PAID` | **admin** | **không đổi** | **không có** | `processedAt`, `processedById`, `bankTransferRef` |
| `PENDING`/`APPROVED` → `REJECTED` | **admin** | **+X** | `WITHDRAWAL_REVERSAL` | `processedAt`, `processedById`, `rejectionReason` |

**`PAID` là trạng thái cuối.** Không đường nào ra khỏi nó — tiền đã rời ngân hàng công ty, đảo
ngược trong hệ thống sẽ tạo một khoản không có thật (FR-019).

---

## 3. Câu lệnh đổi trạng thái

Cả ba đều **một câu, điều kiện trong `WHERE`** (research R2). Không tách `SELECT`+`UPDATE`.

```sql
-- duyệt
UPDATE "WithdrawalRequest"
   SET status='APPROVED'::"WithdrawalRequestStatus", "processedAt"=now(), "processedById"=$2::uuid
 WHERE id=$1::uuid AND status='PENDING'::"WithdrawalRequestStatus"
RETURNING <ROW_SELECT>;

-- đánh dấu đã chi
UPDATE "WithdrawalRequest"
   SET status='PAID'::"WithdrawalRequestStatus", "processedAt"=now(),
       "processedById"=$2::uuid, "bankTransferRef"=$3
 WHERE id=$1::uuid AND status='APPROVED'::"WithdrawalRequestStatus"
RETURNING <ROW_SELECT>;

-- từ chối — nhận HAI trạng thái nguồn (FR-018)
UPDATE "WithdrawalRequest"
   SET status='REJECTED'::"WithdrawalRequestStatus", "processedAt"=now(),
       "processedById"=$2::uuid, "rejectionReason"=$3
 WHERE id=$1::uuid
   AND status IN ('PENDING'::"WithdrawalRequestStatus",'APPROVED'::"WithdrawalRequestStatus")
RETURNING <ROW_SELECT>;
```

`RETURNING` trả cả `amount` và `publisherUserId`, nên đường từ chối biết ngay hoàn bao nhiêu cho
ai mà không cần đọc lại.

---

## 4. Thứ tự thao tác trong từng đường

### Duyệt và đánh dấu đã chi — không transaction, không khoá `Profile`

```
1. UPDATE có điều kiện
   └─ 0 dòng ⇒ đọc lại đơn CHỈ để chọn lỗi:
        không tồn tại        ⇒ không tìm thấy
        tồn tại, sai trạng thái ⇒ xung đột, nêu rõ trạng thái hiện tại
2. trả về đơn đã đổi
```

Một câu lệnh đơn lẻ đã là nguyên tử; không có việc thứ hai để gộp vào transaction. Và chúng không
đụng số dư nên không khoá `Profile` (research R4).

### Từ chối — có transaction, khoá `Profile` trước

```
   ┌─ BEGIN ──────────────────────────────────────────────
1. │ lock Profile của publisher FOR UPDATE      ← giữ thứ tự khoá toàn cục
   │   └─ không có hồ sơ ⇒ báo lỗi rõ ràng, KHÔNG đổi trạng thái đơn (FR-026)
2. │ UPDATE có điều kiện → RETURNING amount, publisherUserId
   │   └─ 0 dòng ⇒ đọc lại chọn lỗi 404 / 409
3. │ creditUserBalance()  → balanceAfter        ← hàm đã có sẵn
4. │ recordWithdrawalReversal({ createdById, note })   ← BẮT BUỘC đủ hai (FR-023)
   └─ COMMIT ────────────────────────────────────────────
```

**Bước 1 trước bước 2** là điều bắt buộc: khoá `Profile` trước rồi mới chạm dòng đơn, cùng chiều
với đường nhà phát hành tự huỷ. Làm ngược là tạo chu trình khoá.

---

## 5. Truy vấn đọc

### 5.1 Danh sách đơn cho quản trị viên

```sql
SELECT w.*, u.email, pr."fullName"
FROM "WithdrawalRequest" w
JOIN "User" u    ON u.id = w."publisherUserId"
JOIN "Profile" pr ON pr."userId" = w."publisherUserId"
WHERE ($1::"WithdrawalRequestStatus"[] IS NULL OR w.status = ANY($1))
ORDER BY w."createdAt" DESC, w.id ASC      -- tiêu chí phụ: FR-007
LIMIT $2 OFFSET $3;
```

`JOIN` lấy tên và email để thoả FR-006 (danh tính dạng người đọc được). Không lọc trạng thái khi
tham số bỏ trống — FR-005.

### 5.2 Sổ cái toàn hệ thống, ba bộ lọc AND với nhau

```sql
WHERE ($1::uuid IS NULL OR w."userId" = $1)
  AND ($2::"WalletTransactionType"[] IS NULL OR w.type = ANY($2))
  AND ($3::timestamptz IS NULL OR w."createdAt" >= $3)
  AND ($4::timestamptz IS NULL OR w."createdAt" <  $4)
ORDER BY w."createdAt" DESC, w.id ASC
```

Mốc kết thúc so bằng `<` chứ không `<=`: client truyền đầu ngày hôm sau là lấy trọn ngày hôm nay
mà không phải lo giây cuối cùng.

### 5.3 Ví một người dùng, phân tách cả hai chiều

```sql
SELECT type, direction, SUM(amount) tong, count(*) so_dong
FROM "WalletTransaction" WHERE "userId" = $1
GROUP BY type, direction;
```

Tầng ứng dụng xếp thành hai nhóm và **phải tự cân** (FR-030a):

```
vào : TOPUP + EARNING + ADMIN_GRANT + WITHDRAWAL_REVERSAL
ra  : PURCHASE + WITHDRAWAL
vào − ra = số dư hiện tại
```

> **`WITHDRAWAL_REVERSAL` nằm ở nhóm VÀO.** Bỏ sót nó sẽ làm mọi ví từng có đơn bị từ chối hiện ra
> là lệch — và đó đúng là những ví quản trị viên hay mở xem nhất.

### 5.4 Bảng đối soát

Sáu truy vấn **lấy nguyên** từ `docs/deployment-runbook.md` mục B9.3, không viết lại (research R7):

| Phép | Trả về | Hiển thị |
|---|---|---|
| (a) ví người dùng lệch | các dòng vi phạm | **nêu đích danh** từng ví |
| (b) ví sàn lệch | các dòng vi phạm | nêu đích danh |
| (c) đơn hàng lệch | các dòng vi phạm | nêu đích danh |
| (d) chuyển khoản lệch | các dòng vi phạm | nêu đích danh |
| (f) đơn rút vs sổ cái | hai tổng | cả hai số và hiệu |
| (e) bảng dòng tiền | 6 con số | kèm **đẳng thức có cân không** |

```
tiền mặt vào + tự phát hành − đã chi thật
    = nợ người dùng + ví sàn + đang chờ chi

  đã chi thật  = SUM(amount) đơn ở trạng thái PAID
  đang chờ chi = SUM(amount) đơn ở trạng thái PENDING hoặc APPROVED
```

Hai túi tính từ **trạng thái đơn**, không từ sổ cái (FR-033a).

---

## 6. Thực thể Zod

```
withdrawal.model.ts  (thêm)
├── GetAdminWithdrawalsInput     { page, limit, status? (nhiều giá trị) }
├── AdminWithdrawalOutput        WithdrawalOutput + { publisher: {userId, fullName, email}, processedById }
├── GetAdminWithdrawalsOutput    { items, totalItems, page, pageSize, totalPages }
├── RejectWithdrawalInput        { reason: chuỗi đã trim, không rỗng }
└── MarkPaidWithdrawalInput      { bankTransferRef: chuỗi đã trim, không rỗng }

wallet.model.ts  (thêm)
├── GetAdminLedgerInput          { page, limit, userId?, types?, from?, to? }
├── AdminLedgerOutput            { items, totalItems, page, pageSize, totalPages }
├── UserWalletOutput             { user, balance, breakdown: {in[], out[], tong_vao, tong_ra}, items }
└── ReconciliationOutput         { cashflow{...}, balanced, checks[] }
```

**Hai bẫy kiểu đã biết của repo**:
- output dùng `zBigIntAsString()` thì type phải là `z.input<typeof X>`, **không phải** `z.infer`
- danh sách trả khoá `items`, **không phải** `data` — `transform.interceptor.ts` đã tự bọc `{data}`

`RejectWithdrawalInput` và `MarkPaidWithdrawalInput` phải `.trim()` **trước** khi kiểm rỗng, nếu
không chuỗi toàn khoảng trắng sẽ lọt (FR-021, FR-015).

Khoảng thời gian kiểm `from <= to` bằng `superRefine` ở tầng schema (FR-029).

---

## 7. Quy tắc nghiệp vụ gắn vào đâu

| Quy tắc | FR | Nơi thực thi |
|---|---|---|
| Chỉ quản trị viên | 001-003 | Gác quyền theo vai trò (không `@SkipPermissionCheck()`) |
| Duyệt chỉ từ `PENDING` | 008, 009 | `WHERE status='PENDING'` trong câu `UPDATE` |
| Chi chỉ từ `APPROVED` | 013, 014 | `WHERE status='APPROVED'` |
| Từ chối từ `PENDING` hoặc `APPROVED` | 018 | `WHERE status IN (...)` |
| `PAID` không từ chối được | 019 | không nằm trong `IN (...)` ở trên |
| Lý do / mã giao dịch không rỗng | 015, 021 | DTO, `.trim()` trước khi kiểm |
| Duyệt và chi không đổi số dư | 011, 016 | hai đường đó **không gọi** hàm nào của `WalletRepo` |
| Hoàn đúng một lần | 024 | `UPDATE` có điều kiện (chính) + unique index (lưới an toàn) |
| Đổi trạng thái và hoàn tiền cùng transaction | 025 | `@Transactional()` bọc đường từ chối |
| Không có hồ sơ thì không đổi trạng thái | 026 | khoá `Profile` **trước** câu `UPDATE` |
| Bảng ví tự cân | 030a | gộp theo loại cả hai chiều |
| Hai túi tính theo trạng thái đơn | 033a | `WHERE status='PAID'` và `IN ('PENDING','APPROVED')` |
