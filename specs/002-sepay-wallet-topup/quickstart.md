# Quickstart: Nạp tiền qua Sepay

Validate tính năng end-to-end sau khi implement, theo đúng User Story 1 & 2 của
`spec.md` và contract trong `contracts/topup-api.md`.

## Chuẩn bị

1. Theo đúng thứ tự dev cục bộ trong README (`npm install` → `.env` → `npm run compose-up`
   → `npm run prisma:generate` → `npm run prisma:migrate:deploy` → `npm run seed:roles` →
   `npm run seed:permissions` → `npm run start:dev`).
2. Thêm các biến môi trường mới (xem `research.md` §2, §6) vào `.env`:
   - `SEPAY_WEBHOOK_API_KEY` — đặt một giá trị test bất kỳ, ví dụ `test-webhook-key`.
   - `SEPAY_BANK_ACCOUNT_NUMBER`, `SEPAY_BANK_NAME`, `SEPAY_BANK_ACCOUNT_HOLDER` — thông
     tin hiển thị khi tạo yêu cầu nạp tiền.
   - `SEPAY_API_BASE_URL`, `SEPAY_API_TOKEN` — dùng cho job đối soát (có thể để trống/mock
     khi chỉ test luồng webhook).
3. Chạy lại `npm run seed:permissions` sau khi route mới tồn tại, để permission record
   của `POST /topups` được tạo (Nguyên tắc II) — nếu không, user thường sẽ bị 403.
4. Đăng nhập một user test, lấy access token (qua `POST /auth/login` hiện có).

## Scenario 1 — Tạo yêu cầu nạp tiền và cộng tiền qua webhook (User Story 1)

```bash
# 1. Tạo yêu cầu nạp tiền
curl -s -X POST http://localhost:3000/api/v1/topups \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 500000}'
# → lưu lại "referenceCode" trong response, ví dụ "A2M7F3K9"

# 2. Giả lập webhook Sepay báo giao dịch khớp mã tham chiếu đó
curl -s -X POST http://localhost:3000/api/v1/topups/sepay/webhook \
  -H "Authorization: Apikey test-webhook-key" \
  -H "Content-Type: application/json" \
  -d '{
    "id": 1,
    "gateway": "Vietcombank",
    "transactionDate": "2026-10-08 10:00:00",
    "accountNumber": "0123456789",
    "content": "A2M7F3K9 chuyen tien",
    "transferAmount": 500000,
    "transferType": "in"
  }'

# 3. Kiểm tra số dư đã cộng đúng
curl -s http://localhost:3000/api/v1/profiles/me -H "Authorization: Bearer $ACCESS_TOKEN"
# → "balance": 500000
```

**Kỳ vọng**: bước 3 trả `balance = 500000`, khớp đúng SC-001/SC-004/Acceptance Scenario 2
của User Story 1.

## Scenario 2 — Webhook báo trùng không cộng thêm (FR-005)

Gọi lại đúng request ở bước 2 (cùng `"id": 1`) một lần nữa, rồi kiểm tra lại
`GET /profiles/me` — `balance` PHẢI vẫn là `500000`, không tăng thêm. Khớp Acceptance
Scenario 3 của User Story 1 / SC-002.

## Scenario 3 — Webhook với API key sai bị từ chối (FR-010)

Lặp lại request webhook ở bước 2 nhưng đổi header thành `-H "Authorization: Apikey wrong-key"`.

**Kỳ vọng**: response `401`, `balance` không đổi, log ghi nhận lần từ chối (kiểm tra log
server). Khớp Edge Case "thông báo giả mạo" / SC-005.

## Scenario 4 — Giao dịch không khớp mã tham chiếu (FR-004)

Lặp lại webhook ở bước 2 với `"id": 2` và `"content": "KHONG-KHOP chuyen tien"` (không
chứa mã tham chiếu nào đang `PENDING`).

**Kỳ vọng**: response `200`, không user nào bị cộng tiền; bản ghi `TopUpTransaction` mới
tồn tại ở trạng thái `UNMATCHED`, có `rawContent = "KHONG-KHOP chuyen tien"` (kiểm tra
trực tiếp qua Prisma Studio hoặc query DB — v1 không có API xem danh sách này, xem
`data-model.md`). `rawContent` PHẢI có giá trị — đây là field support dùng để tra cứu tay
khi xử lý giao dịch này. Khớp Acceptance Scenario 4 / SC-003.

## Scenario 5 — Đối soát chủ động bắt được giao dịch bị thiếu webhook (FR-011)

**Bắt buộc** — không phải scenario tùy chọn, vì FR-011/SC-006 là yêu cầu bắt buộc của
spec (xem `tasks.md` T021). Tạo một yêu cầu nạp tiền mới (lấy `referenceCode` mới),
**không** gọi webhook, mà insert thẳng một "giao dịch Sepay" tương ứng vào nguồn mà job
đối soát đọc (mock Sepay API theo cách implementation chọn — xem `tasks.md` T012/T015).
Chờ tới chu kỳ chạy job (hoặc trigger job thủ công nếu có lệnh test riêng), sau đó kiểm
tra lại `GET /profiles/me` — số dư PHẢI được cộng đúng mà không cần gọi webhook. Khớp
SC-006.
