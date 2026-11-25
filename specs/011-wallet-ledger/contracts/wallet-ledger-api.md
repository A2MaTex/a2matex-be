# API Contract: Sổ cái ví và tài khoản tiền của sàn (phase 3)

**Spec**: [../spec.md](../spec.md) · **Data model**: [../data-model.md](../data-model.md) · **Quyết định**: [../research.md](../research.md)

Tiền tố `API_PREFIX` (mặc định `api/v1`). Số tiền serialize thành **chuỗi thập phân**, như
`totalAmount` đang làm, để không đi qua kiểu số của JavaScript.

Ba route: một cho người dùng, hai cho quản trị viên.

---

## 1. Lịch sử biến động ví của chính mình

```text
GET /api/v1/wallet-transactions
```

`@SkipPermissionCheck()` và lọc theo **người đang đăng nhập**. Không có tham số nào nhận id người
dùng — đây là cách FR-025 được thi hành ở tầng thiết kế, không phải ở tầng kiểm tra.

Lý do không dùng permission riêng nằm ở [../research.md](../research.md) R13: repo chưa có cách
seed quyền cho role không phải ADMIN, nên route như vậy sẽ 403 với mọi người ngay sau deploy.

**Query**: `page`, `limit` theo quy ước phân trang đang dùng.

```jsonc
{
  "data": {
    "items": [
      {
        "id": "…",
        "type": "EARNING",            // TOPUP | PURCHASE | EARNING | ADMIN_GRANT
        "direction": "CREDIT",        // CREDIT | DEBIT
        "amount": "14000",            // luôn dương; dấu nằm ở direction
        "balanceAfter": "77000",      // không bao giờ âm
        "orderId": "…",               // null với TOPUP và ADMIN_GRANT
        "topUpTransactionId": null,   // null với PURCHASE, EARNING, ADMIN_GRANT
        "note": null,                 // chỉ ADMIN_GRANT mới có; là lý do quản trị viên ghi
        "createdAt": "2026-11-24T06:00:00.000Z"
      }
    ],
    "totalItems": 15,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1
  }
}
```

Mới nhất trước. `items` + phân trang theo đúng hình dạng các route danh sách khác; interceptor tự
bọc lớp `data` bên ngoài.

**Route này không bao giờ trả về `COMMISSION` hay `ISSUED_CREDIT`**, vì hai loại đó thuộc tài khoản
của sàn chứ không thuộc ví người dùng nào. Nó cũng chỉ trả về **chân `CREDIT`** của một lần
`ADMIN_GRANT` — chân `DEBIT` nằm ở tài khoản của sàn.

**Không có** `systemAccount` và `transferId` trong payload: người dùng không cần biết tiền bù cho
mình rút từ đâu, và lộ ra chỉ thêm bề mặt không dùng tới.

---

## 2. Quản trị viên cộng tiền cho một người dùng

```text
POST /api/v1/admin/wallet-transactions/grant
```

Permission bình thường, seed trong cùng PR (Nguyên tắc II).

```jsonc
// Request
{
  "userId": "…",            // người nhận
  "amount": "2000000",      // chuỗi thập phân, phải > 0
  "note": "Bù lỗi thanh toán đơn #1234 ngày 2026-11-20"   // bắt buộc, không rỗng
}
```

```jsonc
// 201
{
  "data": {
    "transferId": "…",            // nối hai chân của lần chuyển khoản này
    "userId": "…",
    "amount": "2000000",
    "userBalanceAfter": "2000000",      // số dư ví người nhận sau khi cộng
    "systemBalanceAfter": "3180000",    // số dư tài khoản của sàn sau khi trừ
    "createdAt": "2026-11-25T08:00:00.000Z"
  }
}
```

Trả về cả hai số dư là có chủ ý: quản trị viên thấy ngay tài khoản của sàn còn lại bao nhiêu, nên
biết khi nào phải bơm thêm trước khi thao tác tiếp.

### Lỗi

| Tình huống | Mã | Ghi chú |
|---|---|---|
| Tài khoản của sàn **không đủ tiền** | **422** | FR-035. Đây là tình huống **bình thường** ở giai đoạn đầu, không phải sự cố. Thông báo phải nói rõ số dư khả dụng và gợi ý bơm tiền vào trước |
| `amount` ≤ 0, hoặc `note` rỗng/thiếu | 422 | FR-036, FR-037 |
| Người nhận không tồn tại hoặc đã bị xoá | 404 | FR-039 |
| Không phải quản trị viên | 403 | FR-038 |

**422 chứ không phải 500 với trường hợp đầu** là một yêu cầu, không phải sở thích. Chốt chặn nằm ở
conditional update rồi kiểm số dòng bị ảnh hưởng (research.md R12); để `CHECK` của database bắt thì
nó thành lỗi ràng buộc và trả 500 cho một việc hoàn toàn đoán trước được.

---

## 3. Quản trị viên bơm tiền vào tài khoản của sàn

```text
POST /api/v1/admin/system-account/issue-credit
```

Permission riêng, **không dùng chung** với route cộng tiền ở mục 2. Hai việc có tính chất vận hành
khác hẳn nhau: cộng tiền cho khách là việc thường xuyên và luôn có nguồn; bơm tiền là việc hiếm,
làm tăng nợ ảo của hệ thống, và là chỗ đáng đặt hạn mức hoặc quy trình phê duyệt về sau.

```jsonc
// Request
{
  "amount": "5000000",                        // chuỗi thập phân, phải > 0
  "note": "Quỹ thử nghiệm Q4 2026"            // bắt buộc, không rỗng
}
```

```jsonc
// 201
{
  "data": {
    "amount": "5000000",
    "balanceAfter": "5180000",
    "createdAt": "2026-11-25T08:00:00.000Z"
  }
}
```

### Lỗi

| Tình huống | Mã | Ghi chú |
|---|---|---|
| `amount` ≤ 0, hoặc `note` rỗng/thiếu | 422 | FR-043, FR-044 |
| Không phải quản trị viên | 403 | FR-045 |

Route này **không có đường ngược lại** ở phase này — không rút tiền ra khỏi tài khoản của sàn, và
không giảm số dư của nó ngoài việc cộng tiền cho người dùng.

---

## 4. Những gì KHÔNG có route

Ghi ra để không ai đi tìm:

- **Đối soát.** Năm phép ở [../data-model.md](../data-model.md) mục 7 là truy vấn SQL trong
  `docs/deployment-runbook.md`, không phải API (research.md R10).
- **Xem lịch sử tài khoản của sàn.** Người vận hành đọc thẳng từ database. Dựng một route chỉ để
  xem là thêm bề mặt đổi lấy không gì cả (Nguyên tắc VI).
- **Quản trị viên xem lịch sử ví của người khác.** Nằm ngoài phạm vi phase này.
- **Trừ tiền khỏi ví người dùng.** Nằm ngoài phạm vi, và không có loại bút toán nào cho nó.
