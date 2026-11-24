# API Contract: Chia tiền bán hàng (phase 2)

**Spec**: [../spec.md](../spec.md) · **Data model**: [../data-model.md](../data-model.md)

Tiền tố `API_PREFIX` (mặc định `api/v1`). Số tiền là `BIGINT`, serialize thành **chuỗi thập phân**
giống `totalAmount` và `priceAmount` đang làm, để không đi qua kiểu số của JavaScript.

---

## 1. Thay đổi trên đường mua hàng

`POST /api/v1/orders` giữ nguyên request. Response bổ sung phần chia tiền của chính đơn vừa tạo:

```jsonc
{
  "data": {
    "id": "…",
    "totalAmount": "100000",
    "commissionRateBps": 3000,     // tỉ lệ đã áp dụng cho ĐƠN NÀY
    "commissionAmount": "30000",   // phần sàn giữ
    "publisherAmount": "70000",    // phần nhà phát hành nhận
    // … các trường hiện có
  }
}
```

Không trả `publisherUserId` cho khách: khách không cần biết ai nhận tiền, và lộ ra là tiết lộ quan
hệ sở hữu không cần thiết.

### Lỗi mới

| Mã | Khi nào | HTTP |
|----|---------|------|
| `Error.CannotPurchaseOwnProduct` | Người mua chính là nhà phát hành của sản phẩm | 409 |
| `Error.CommissionRateUnavailable` | Không đọc được tỉ lệ hoa hồng | 503 |
| `Error.PublisherProfileNotFound` | Nhà phát hành không có ví để nhận tiền | 500 |

Hai lỗi sau là hỏng hệ thống chứ không phải lỗi của người gọi, và **phải huỷ cả giao dịch** — không
được bán xong mà tiền không tới ai.

Các lỗi hiện có (`Error.InsufficientBalance`, `Error.ProductNotPurchasable`,
`Error.EntitlementStillActive`, …) giữ nguyên hành vi.

### Thứ tự kiểm tra

Chặn tự mua xảy ra **ngay sau khi biết nhà phát hành là ai**, trước khi khoá bất kỳ ví nào — không
giữ khoá cho một giao dịch chắc chắn bị từ chối.

---

## 2. Doanh thu của nhà phát hành

```text
GET /api/v1/publisher-earnings            # danh sách đơn đã bán, mới nhất trước
GET /api/v1/publisher-earnings/summary    # tổng hợp
```

Cả hai gắn `@SkipPermissionCheck()` và lọc theo **người đang đăng nhập**. Không có tham số nào nhận
id nhà phát hành từ client — đây là cách FR-019 được thi hành.

Người không phải nhà phát hành gọi vào sẽ nhận danh sách rỗng và tổng bằng 0, không phải lỗi: họ
đơn giản là chưa bán gì.

Lý do không dùng permission riêng cho vai trò PUBLISHER nằm ở [../research.md](../research.md) R7 —
tóm tắt: repo chưa có cách seed quyền cho role không phải ADMIN, nên route như vậy sẽ 403 với mọi
nhà phát hành ngay sau deploy.

### `GET /api/v1/publisher-earnings`

Query: `page`, `limit` theo đúng quy ước phân trang đang dùng.

```jsonc
{
  "data": {
    "items": [
      {
        "orderId": "…",
        "productId": "…",
        "productName": "Chrome Search & Auto Click",
        "totalAmount": "99000",        // khách trả
        "commissionAmount": "29700",   // sàn giữ
        "publisherAmount": "69300",    // thực nhận
        "commissionRateBps": 3000,
        "paidAt": "2026-11-23T10:00:00.000Z"
      }
    ],
    "totalItems": 3,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1
  }
}
```

`items` + phân trang theo đúng hình dạng của các route danh sách khác trong repo; interceptor tự
bọc lớp `data` bên ngoài.

### `GET /api/v1/publisher-earnings/summary`

```jsonc
{
  "data": {
    "orderCount": 3,
    "grossAmount": "200000",       // tổng khách đã trả
    "commissionAmount": "60000",   // tổng sàn giữ
    "netAmount": "140000"          // tổng thực nhận
  }
}
```

`grossAmount = commissionAmount + netAmount` luôn đúng, và `netAmount` phải khớp tổng cột
`publisherAmount` của danh sách (FR-018).

---

## 3. Doanh thu của sàn

Không có route mới ở phase này. Doanh thu sàn tính từ dữ liệu đơn hàng
(`SUM(commissionAmount)`), đủ cho FR-020. Dựng màn hình quản trị cho nó là việc sau, và khi đó sẽ
cần quyết định xem có trừ đơn hoàn tiền hay không — mà hoàn tiền thuộc phase 5.

---

## 4. Permission

`npm run seed:permissions` tự quét controller và tạo bản ghi:

| Method | Path | Enforce |
|--------|------|---------|
| `GET` | `/api/v1/publisher-earnings` | bỏ qua kiểm tra, lọc theo người đăng nhập |
| `GET` | `/api/v1/publisher-earnings/summary` | bỏ qua kiểm tra, lọc theo người đăng nhập |

Bản ghi vẫn được tạo và gán cho ADMIN như mọi route khác; `@SkipPermissionCheck()` chỉ tác động tới
guard lúc chạy. Chạy seed sau khi controller tồn tại, và xác nhận dòng xoá cache được in ra.

---

## 5. Hợp đồng nội bộ

`OrderService` gọi `SystemSettingService.get('COMMISSION_RATE_BPS')` bên trong giao dịch mua.
`OrderModule` import `SystemSettingCoreModule` — **core**, không phải module có controller.

Hàm tính chia tiền là một hàm thuần, không chạm database:

```ts
splitAmount(totalAmount: bigint, rateBps: number): { commissionAmount: bigint; publisherAmount: bigint }
```

Tách riêng để kiểm thử được toàn bộ các ca biên mà không cần dựng giao dịch.

---

## 6. Cố ý không có ở phase này

- **Không có route hoàn tiền hay thu hồi phần đã chia** — phase 5.
- **Không có đường xem biến động số dư** — phase 3.
- **Không có route quản trị để xem doanh thu toàn sàn** — tính được từ dữ liệu, chưa có nhu cầu màn
  hình.
- **Không cho lọc doanh thu theo khoảng thời gian** ở phase này; 5 đơn thì phân trang là đủ. Thêm
  bộ lọc sau không phá hợp đồng hiện có.
