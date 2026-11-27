# API Contract: Đơn rút tiền cho nhà phát hành

**Phase 1** · 2026-11-27 · [data-model.md](../data-model.md)

Tiền tố: `/api/v1`. Mọi route cần `Authorization: Bearer <access token>`.

Cả bốn route gắn `@SkipPermissionCheck()` (FR-039) và gọi `assertActivePublisher()` trước mọi
việc khác. **Thứ tự khai báo trong controller bắt buộc**: `me` trước `:withdrawalId`, nếu không
Nest đọc `"me"` thành id rồi fail kiểm UUID (`order.controller.ts:41`).

Mọi số tiền là **chuỗi thập phân**, không phải số — giá trị vượt `Number.MAX_SAFE_INTEGER`.

---

## `POST /withdrawals` — tạo đơn

**Header**: `Idempotency-Key: <uuid>` — bắt buộc.

```jsonc
// Request
{
  "amount": "200000",
  "bankAccountNumber": "0123456789",
  "bankName": "Vietcombank",
  "bankAccountHolder": "NGUYEN VAN A"
}
```

`balanceAfter` **chỉ xuất hiện ở hai response làm đổi số dư** (tạo đơn và huỷ đơn), không có trong
`WithdrawalOutput` dùng chung của hai route đọc — xem data-model.md §5.

```jsonc
// 200 OK
{
  "data": {
    "id": "…uuid…",
    "amount": "200000",
    "status": "PENDING",
    "bankAccountNumber": "0123456789",
    "bankName": "Vietcombank",
    "bankAccountHolder": "NGUYEN VAN A",
    "balanceAfter": "300000",       // số dư còn lại, lấy từ chính câu lệnh đã trừ (SC-001)
    "bankTransferRef": null,
    "rejectionReason": null,
    "createdAt": "2026-11-27T10:00:00.000Z",
    "processedAt": null
  }
}
```

`200` chứ không `201`, theo `order.controller.ts:28` (`@HttpCode(200)`): gửi lại cùng khoá chống
lặp trả về đơn **đã có**, mà trả `201 Created` cho một đơn không được tạo mới là nói sai.

### Lỗi

| Mã | Khoá lỗi | Khi nào |
|---|---|---|
| 422 | `Error.WithdrawalIdempotencyKeyRequired` | Thiếu header hoặc không phải UUID (decorator `IdempotencyKey` dùng chung ném `UnprocessableEntity`, không phải 400) |
| 401 | — | Token thiếu/hết hạn |
| 403 | `Error.PublisherUserNotActive` | Tài khoản người dùng không hoạt động |
| 403 | `Error.PublisherNotActivated` | Không phải nhà phát hành (FR-001) |
| 403 | `Error.PublisherBlocked` | Nhà phát hành bị khoá (FR-003) |
| 403 | `Error.PublisherAccessDenied` | Mất vai trò nhà phát hành |
| 403 | `Error.PublisherTermsNotAccepted` | Chưa ký điều khoản |
| 404 | `Error.WithdrawalProfileNotFound` | Không tìm thấy hồ sơ để trừ tiền |
| 409 | `Error.WithdrawalIdempotencyKeyReused` | Khoá dùng lại cho nội dung khác (FR-035) |
| 422 | `Error.WithdrawalAmountInvalid` | ≤ 0, không phải số, hoặc vượt trần `BIGINT` |
| 422 | `Error.WithdrawalBelowMinimum` | Dưới mức tối thiểu (FR-010) |
| 422 | `Error.WithdrawalInsufficientBalance` | Không đủ số dư (FR-006, FR-008) |
| 422 | `Error.WithdrawalCooldownActive` | Chưa đủ 24 giờ (FR-013) |
| 503 | `Error.WithdrawalMinAmountUnavailable` | Mức tối thiểu chưa cấu hình / sai định dạng (FR-012) |

`Error.WithdrawalCooldownActive` **phải kèm thời điểm sớm nhất được tạo đơn tiếp** (FR-015).

> **503 chỉ dành cho lỗi cấu hình.** Lỗi hạ tầng lúc đọc setting — hết thời gian chờ khoá, mất kết
> nối — phải **ném nguyên dạng lỗi của nó**, không bọc thành 503 (FR-012a). Bọc sẽ chỉ người vận
> hành đi sửa một dòng cấu hình hoàn toàn bình thường. Xem `order.service.ts:62-79`.

---

## `GET /withdrawals/me` — danh sách đơn của chính mình

**Query**: `page` (mặc định 1), `limit` (mặc định 10, trần `WITHDRAWAL_PAGE_SIZE_MAX`).

```jsonc
// 200 OK
{
  "data": {
    "items": [ /* WithdrawalOutput, mới nhất trước */ ],
    "totalItems": 3, "page": 1, "pageSize": 10, "totalPages": 1
  }
}
```

Khoá `items`, **không phải** `data` — `transform.interceptor.ts` đã tự bọc `{data: ...}`, trả
`data` sẽ bị bọc hai lần.

Trả về **mọi** đơn của publisher, **không lọc trạng thái** — kể cả `CANCELLED` và `REJECTED`.
Đơn rút tiền là chứng từ tiền, publisher phải tra lại được đơn mình đã huỷ.

Sắp theo `createdAt DESC, id ASC`. `createdAt` một mình **không phải thứ tự toàn phần**: cột mặc
định `now()` tức thời điểm bắt đầu transaction, nên hai đơn cùng mốc sẽ xếp tuỳ ý và client lật
trang có thể thấy trùng hoặc sót dòng. Cùng quy ước với `order.repo.ts:236` và `wallet.repo.ts`.

---

## `GET /withdrawals/:withdrawalId` — chi tiết

`404 Error.WithdrawalNotFound` cho **cả hai** trường hợp: id không tồn tại, và id của nhà phát
hành khác. Câu trả lời phải **giống hệt nhau** (FR-036) — khác nhau là tiết lộ sự tồn tại.

---

## `POST /withdrawals/:withdrawalId/cancel` — huỷ đơn

Không có body.

`POST .../cancel` chứ không `DELETE`: đơn không bị xoá, nó chuyển sang `CANCELLED` và để lại một
bút toán hoàn tiền.

```jsonc
// 200 OK
{
  "data": {
    "id": "…uuid…",
    "status": "CANCELLED",
    "amount": "200000",
    "balanceAfter": "500000",       // số dư sau khi cộng trả
    "processedAt": "2026-11-27T10:05:00.000Z"
    // … các trường còn lại
  }
}
```

| Mã | Khoá lỗi | Khi nào |
|---|---|---|
| 404 | `Error.WithdrawalNotFound` | Không tồn tại **hoặc** của người khác |
| 409 | `Error.WithdrawalNotPending` | Đơn đã `CANCELLED` / `APPROVED` / `REJECTED` / `PAID` (FR-026) |

### Dùng lại khoá chống lặp sau khi đã huỷ

Gửi `POST /withdrawals` với **đúng khoá chống lặp của một đơn đã huỷ** sẽ trả về **chính đơn đã
huỷ đó** (`status: "CANCELLED"`), **không** tạo đơn mới và **không** trừ tiền. Đây là ngữ nghĩa
đúng của chống lặp: cùng khoá ⇒ cùng kết quả. Muốn tạo đơn mới thì client phải sinh **khoá mới**.

Trên thực tế điều này hiếm khi gặp, vì đơn đã huỷ **vẫn tính vào mốc 24 giờ** (FR-014): dù dùng
khoá mới thì publisher vẫn bị chặn tới khi đủ 24 giờ kể từ lúc tạo đơn đã huỷ.

Hai lệnh huỷ chạy song song: lệnh thứ hai bị chặn ở **khoá dòng của câu `UPDATE` có điều kiện**,
rồi đánh giá lại mệnh đề `WHERE` sau khi lệnh đầu commit (`READ COMMITTED`), khớp **0 dòng** và
nhận **409** — **không bao giờ** 500 từ vi phạm unique index (FR-025a, SC-009, research.md R8).

---

## Không thuộc lát cắt này

Đã chốt làm ở lát cắt sau, ghi ra đây để không ai tưởng là bỏ sót:

- `GET /admin/withdrawals` — danh sách đơn chờ duyệt
- `POST /admin/withdrawals/:id/approve`
- `POST /admin/withdrawals/:id/reject` — kèm lý do, sinh `WITHDRAWAL_REVERSAL` có `createdById`
- `POST /admin/withdrawals/:id/mark-paid` — kèm `bankTransferRef`, **không sinh bút toán nào**
  (tiền đã rời ví từ lúc tạo đơn; bước này chỉ chuyển "đang chờ chi" sang "đã chi thật" trong
  phép đối soát)
- Sửa thông tin ngân hàng của đơn đang `PENDING`
