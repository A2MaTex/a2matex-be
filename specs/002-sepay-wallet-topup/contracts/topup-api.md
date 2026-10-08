# API Contract: Nạp tiền qua Sepay

Base path: `API_PREFIX` (hiện tại `api/v1`). Theo convention module hiện có
(`src/routes/profile`, `src/routes/auth`), request/response là JSON, validate bằng Zod
(`nestjs-zod`), lỗi trả theo `HttpExceptionFilter` hiện có.

## `POST /topups` — Tạo yêu cầu nạp tiền (FR-001)

Auth: Bearer (route thường, có permission record — Nguyên tắc II).

**Request body**:

```jsonc
{
  "amount": 500000 // số nguyên, VND, > 0
}
```

**Response `201`**:

```jsonc
{
  "referenceCode": "A2M7F3K9", // mã tham chiếu riêng cho yêu cầu này
  "amount": 500000,
  "bankAccountNumber": "0123456789",
  "bankName": "Vietcombank",
  "accountHolderName": "CONG TY A2MATEX",
  "transferContent": "A2M7F3K9" // nội dung chuyển khoản user phải ghi đúng
}
```

**Lỗi**:
- `400` — `amount` không hợp lệ (≤0, không phải số nguyên).
- `401` — thiếu/sai access token (hành vi chuẩn của `AccessTokenGuard`).

Không giới hạn min/max ở tầng này trong v1 (theo Assumptions của spec).

---

## `POST /topups/sepay/webhook` — Nhận thông báo giao dịch từ Sepay (FR-002, FR-010)

Auth: **Public route** (`@IsPublic()`), xác thực bằng header `Authorization: Apikey <key>`
(Sepay gửi đúng tiền tố `Apikey ` — theo tài liệu chính thức
[docs.sepay.vn/tich-hop-webhooks.html](https://docs.sepay.vn/tich-hop-webhooks.html)), key
dạng shared-secret cấu hình trong Sepay dashboard — research.md §2. Không dùng
`AccessTokenGuard`.

**Request** (theo format webhook mà Sepay gửi — rút gọn các field hệ thống dùng tới):

```jsonc
{
  "id": 92704,                       // ID giao dịch do Sepay cấp → providerTransactionId
  "gateway": "Vietcombank",
  "transactionDate": "2026-10-08 10:23:00",
  "accountNumber": "0123456789",
  "content": "A2M7F3K9 chuyen tien", // nội dung chuyển khoản thực tế — chứa mã tham chiếu
  "transferAmount": 500000,
  "transferType": "in"               // chỉ xử lý "in" (tiền vào); bỏ qua "out"
}
```

**Xử lý** (tái sử dụng cho cả reconciliation — research.md §6):
1. Nếu `transferType != "in"` → bỏ qua, trả `200` (không phải giao dịch nạp tiền).
2. Xác thực header `Authorization`; sai/thiếu → `401`, ghi log, KHÔNG xử lý tiếp (FR-010).
3. Nếu `id` đã tồn tại như `providerTransactionId` trong `TopUpTransaction` → no-op, trả
   `200` (idempotent — FR-005).
4. Tìm mã tham chiếu khớp trong `content`:
   - Khớp một `TopUpTransaction` đang `PENDING` → set `receivedAmount`, `providerTransactionId`,
     `rawContent = content`, `status = CREDITED`, `creditedAt`; cộng `receivedAmount` vào
     `Profile.balance` của `userId` đó — trong 1 DB transaction (research.md §3).
   - Không khớp → tạo bản ghi mới `status = UNMATCHED`, `providerTransactionId`,
     `receivedAmount`, `rawContent = content`, `userId = NULL` (FR-004) — `rawContent` là
     manh mối duy nhất để nhân viên hỗ trợ tra cứu tay (data-model.md § TopUpTransaction).

**Response**: `200 { "success": true }` cho mọi trường hợp đã xử lý hợp lệ (kể cả no-op
và unmatched) — Sepay chỉ cần biết hệ thống đã nhận được, không cần biết kết quả nghiệp
vụ. `401` chỉ khi xác thực nguồn thất bại (bước 2).

---

## `GET /profiles/me` — Xem số dư (FR-007) — endpoint có sẵn, mở rộng response

Auth: Bearer (không đổi).

**Response `200`** (các field hiện có giữ nguyên, thêm `balance`):

```jsonc
{
  "id": "…",
  "fullName": "…",
  // … các field hiện có khác …
  "balance": 500000
}
```
