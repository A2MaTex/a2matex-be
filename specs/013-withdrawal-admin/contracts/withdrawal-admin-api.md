# API Contract: Quản trị viên duyệt đơn rút tiền và xem sổ cái

**Phase 1** · 2026-11-27 · [data-model.md](../data-model.md)

Tiền tố `/api/v1`. Bảy route **đều gác quyền theo vai trò** — không route nào dùng
`@SkipPermissionCheck()`. Người dùng thường và nhà phát hành nhận 403 ở mọi route.

Mọi số tiền là **chuỗi thập phân**, không phải số.

---

## Nhóm A — Duyệt đơn rút tiền

### `GET /admin/withdrawals`

**Query**: `page` (mặc định 1), `limit` (mặc định 10, trần 100), `status` (nhiều giá trị, bỏ
trống = **mọi trạng thái** kể cả `CANCELLED` và `REJECTED`).

```jsonc
{
  "data": {
    "items": [{
      "id": "…", "amount": "200000", "status": "PENDING",
      "bankAccountNumber": "0123456789", "bankName": "Vietcombank",
      "bankAccountHolder": "NGUYEN VAN A",
      "publisher": { "userId": "…", "fullName": "Nguyễn Văn A", "email": "a@example.com" },
      "bankTransferRef": null, "rejectionReason": null,
      "createdAt": "…", "processedAt": null, "processedById": null
    }],
    "totalItems": 3, "page": 1, "pageSize": 10, "totalPages": 1
  }
}
```

Khối `publisher` là bắt buộc (FR-006): quản trị viên phải nhận ra họ đang chi tiền cho ai mà không
cần tra cứu thêm. Sắp theo `createdAt DESC, id ASC`.

---

### `POST /admin/withdrawals/:withdrawalId/approve`

Không body. `PENDING` → `APPROVED`.

**Không đổi số dư ai, không sinh bút toán nào.** Tiền đã rời ví nhà phát hành từ lúc tạo đơn.

| Mã | Khoá lỗi | Khi nào |
|---|---|---|
| 403 | — | Không phải quản trị viên |
| 404 | `Error.WithdrawalNotFound` | Mã đơn không tồn tại |
| 409 | `Error.WithdrawalNotPending` | Đơn không ở trạng thái chờ duyệt (lỗi nêu rõ trạng thái hiện tại) |

---

### `POST /admin/withdrawals/:withdrawalId/reject`

```jsonc
{ "reason": "Số tài khoản không khớp tên chủ tài khoản" }
```

`PENDING` **hoặc** `APPROVED` → `REJECTED`. **Hoàn tiền về ví nhà phát hành** và ghi một bút toán
hoàn kèm người thực hiện và lý do.

```jsonc
{ "data": { "id": "…", "status": "REJECTED", "amount": "200000",
            "balanceAfter": "500000", "rejectionReason": "…", "processedAt": "…" } }
```

| Mã | Khoá lỗi | Khi nào |
|---|---|---|
| 404 | `Error.WithdrawalNotFound` | Mã đơn không tồn tại |
| 404 | `Error.WithdrawalProfileNotFound` | Hồ sơ nhà phát hành không còn để hoàn tiền vào |
| 409 | `Error.WithdrawalCannotReject` | Đơn đã `PAID`, `CANCELLED` hoặc `REJECTED` |
| 422 | `Error.WithdrawalRejectionReasonRequired` | Lý do rỗng hoặc chỉ có khoảng trắng |

> **Đơn `PAID` không từ chối được.** Tiền đã rời ngân hàng công ty; đảo ngược trong hệ thống sẽ
> tạo ra một khoản tiền không có thật trong ví nhà phát hành.

---

### `POST /admin/withdrawals/:withdrawalId/mark-paid`

```jsonc
{ "bankTransferRef": "FT26112700001" }
```

`APPROVED` → `PAID`. **Không đổi số dư, không sinh bút toán nào.** Bước này chỉ chuyển số tiền từ
túi "đang chờ chi" sang túi "đã chi thật" trong bảng đối soát, mà hai túi tính từ trạng thái đơn.

| Mã | Khoá lỗi | Khi nào |
|---|---|---|
| 404 | `Error.WithdrawalNotFound` | Mã đơn không tồn tại |
| 409 | `Error.WithdrawalNotApproved` | Đơn chưa được duyệt, hoặc đã `PAID` |
| 422 | `Error.WithdrawalTransferRefRequired` | Mã giao dịch rỗng hoặc chỉ có khoảng trắng |

> Đơn **chưa duyệt** không đánh dấu chi được. Thứ tự duyệt-rồi-chi là bắt buộc (FR-014).

---

## Nhóm B — Xem sổ cái

### `GET /admin/wallet-transactions`

**Query**: `page`, `limit` (trần 100), `userId`, `types` (nhiều giá trị), `from`, `to`.
Ba bộ lọc độc lập, kết hợp bằng AND; bỏ trống = không lọc theo tiêu chí đó.

Mốc `to` **loại trừ** (`createdAt < to`), không phải bao gồm. Muốn lấy trọn ngày 01/11 thì truyền
`from=2026-11-01&to=2026-11-02`, **không phải** `to=2026-11-01` — truyền bằng nhau sẽ trả về rỗng
kèm HTTP 200, không phân biệt được với một ngày không có giao dịch nào.

| Mã | Khoá lỗi | Khi nào |
|---|---|---|
| 422 | `Error.LedgerDateRangeInvalid` | `from` sau `to` |
| 422 | — | `limit` vượt trần |

Sắp theo `createdAt DESC, id ASC` — `createdAt` một mình không phải thứ tự toàn phần vì ba bút
toán của cùng một đơn hàng mang cùng mốc.

---

### `GET /admin/users/:userId/wallet`

```jsonc
{
  "data": {
    "user": { "userId": "…", "fullName": "…", "email": "…" },
    "balance": "5791800",
    "breakdown": {
      "in":  [{ "type": "EARNING", "total": "9800", "count": 3 },
              { "type": "ADMIN_GRANT", "total": "5800000", "count": 1 }],
      "out": [{ "type": "PURCHASE", "total": "18000", "count": 2 }],
      "totalIn": "5809800", "totalOut": "18000"
    },
    "items": [ /* lịch sử bút toán, phân trang */ ]
  }
}
```

**`totalIn − totalOut` phải bằng đúng `balance`** (FR-030a). Một bảng dùng để quyết định chi tiền
mà không tự cân được thì không kiểm chứng được.

`WITHDRAWAL_REVERSAL` nằm ở nhóm **`in`**. Bỏ sót nó làm mọi ví từng có đơn bị từ chối hiện ra là
lệch — đúng những ví hay bị mở xem nhất.

| Mã | Khoá lỗi | Khi nào |
|---|---|---|
| 404 | `Error.WalletUserNotFound` | Mã người dùng không tồn tại |

Người dùng chưa từng có biến động nào trả về số dư `"0"` và các mảng rỗng — **không phải lỗi**.

---

### `GET /admin/wallet-transactions/reconciliation`

```jsonc
{
  "data": {
    "cashflow": {
      "cashIn": "36000", "issuedCredit": "15994000", "paidOut": "0",
      "owedToUsers": "16696800", "platformBalance": "333200", "awaitingPayout": "0",
      "leftSide": "16030000", "rightSide": "17030000", "balanced": false
    },
    "checks": [
      { "code": "a", "label": "Ví người dùng khớp sổ cái", "ok": false,
        "offenders": [{ "userId": "…", "email": "…", "balance": "990000", "fromLedger": "-10000" }] },
      { "code": "b", "label": "Ví sàn khớp sổ cái", "ok": true, "offenders": [] },
      { "code": "c", "label": "Đơn hàng khớp ba bút toán", "ok": true, "offenders": [] },
      { "code": "d", "label": "Chuyển khoản đủ hai chân", "ok": true, "offenders": [] },
      { "code": "f", "label": "Đơn rút chưa hoàn khớp sổ cái", "ok": true,
        "fromRequests": "0", "fromLedger": "0", "diff": "0" }
    ]
  }
}
```

Mỗi phép kiểm **nêu đích danh** bản ghi vi phạm, không chỉ nói có lỗi (FR-036). Ví dụ trên là số
liệu thật của production ngày 2026-11-27 — có một ví lệch 1.000.000đ do bị đặt số dư bằng SQL
trực tiếp.

Đẳng thức dùng **dạng hai túi**: `awaitingPayout` là khoản hệ thống **vẫn đang nợ** (tiền đã rời
ví nhà phát hành nhưng còn trong ngân hàng công ty), khác hẳn `paidOut`.

> Route đắt nhất hệ thống — sáu truy vấn quét toàn bảng. Chấp nhận ở quy mô hiện tại; khi chậm thì
> việc đúng là chạy định kỳ và lưu kết quả, không phải cache.

---

## Không thuộc spec này

- Gọi API chuyển tiền tự động — đã chốt chuyển khoản tay
- Thông báo cho nhà phát hành khi đơn đổi trạng thái
- Sửa thông tin ngân hàng trên đơn — sai thì từ chối, publisher tạo đơn mới
- Hạn mức chi, phê duyệt nhiều cấp
- Quản trị viên **trừ** tiền khỏi ví người dùng
- Nhật ký đầy đủ từng lần đổi trạng thái — `processedById` chỉ giữ người gần nhất
