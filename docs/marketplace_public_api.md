# Marketplace Public API — tài liệu ghép nối cho Frontend

Ba endpoint công khai phục vụ trang Marketplace, cộng với đường tải ảnh. Tất cả đều **không cần đăng nhập**.

Cập nhật: 2026-11-19. Hợp đồng gốc: `a2matex-docs/components/a2matex-backend/product_submission_release/product.md` §5.6.

## 1. Tổng quan

| | |
| --- | --- |
| Base URL (production) | `https://api.a2matex.com/api/v1` |
| Base URL (local) | `http://localhost:9999/api/v1` |
| Authorization | không cần; gửi kèm token cũng không ảnh hưởng |
| CORS | `Access-Control-Allow-Origin: *` |
| Swagger | `<base>/docs` |

Mọi response thành công bọc trong một envelope cố định:

```json
{ "data": {}, "statusCode": 200 }
```

Lỗi không có `data`:

```json
{ "statusCode": 404, "message": "Error.ProductNotFound" }
```

Riêng lỗi validate (422) thì `message` là mảng, mỗi phần tử chỉ ra field sai:

```json
{
  "statusCode": 422,
  "message": [{ "message": "Too big: expected number to be <=100", "path": "limit" }]
}
```

## 2. Danh sách sản phẩm

```http
GET /marketplace/products?page=1&limit=10&q=reward
```

| Query param | Kiểu | Mặc định | Ràng buộc |
| --- | --- | --- | --- |
| `page` | số nguyên | `1` | > 0 |
| `limit` | số nguyên | `10` | > 0, tối đa `100` |
| `q` | chuỗi | — | 1–100 ký tự sau khi trim; tìm trong tên và mô tả |

Tham số lạ bị từ chối: `?foo=1` trả **422** `Unrecognized key: "foo"`. Gửi `q=` rỗng cũng 422.

Mặc định sắp xếp theo ngày phát hành bản release hiện tại, mới nhất trước.

```json
{
  "data": {
    "items": [
      {
        "id": "94458c5e-3f04-49c2-917e-bbcdb35eda14",
        "name": "HTTP Verify Product",
        "slug": "http-verify-product",
        "shortDescription": "snapshot short description",
        "publisher": { "username": "pub634f2966", "displayName": "Publisher Smoke" },
        "currentRelease": {
          "id": "7abb2b89-08ba-42a1-9c29-cd62d3e64c26",
          "version": "2.0.1",
          "publishedAt": "2026-11-19T04:42:21.804Z",
          "minimumLauncherVersion": "0.4.0",
          "minimumRuntimeVersion": "0.5.0"
        },
        "minimumSubscriptionOffer": { "priceAmount": "100000", "durationDays": 7 },
        "media": [
          {
            "id": "00000000-0000-4000-8000-000000000003",
            "staticId": "5c1f0a76-2b94-4f3e-8d61-0a2c7e9b4d15",
            "type": "COVER",
            "sortOrder": 0,
            "altText": null
          }
        ]
      }
    ],
    "totalItems": 1,
    "page": 1,
    "limit": 10,
    "totalPages": 1
  },
  "statusCode": 200
}
```

`minimumSubscriptionOffer` là gói SUBSCRIPTION rẻ nhất đang bán; `durationDays` luôn thuộc đúng gói
rẻ nhất đó. Gói ONE_TIME không tham gia vào trường này. Dùng để vẽ nhãn kiểu "từ 100.000đ / 7 ngày".

`media` ở list **chỉ gồm `ICON` và `COVER`** — đủ cho card. Gallery chỉ có ở detail.

## 3. Chi tiết sản phẩm

```http
GET /marketplace/products/{productId}
```

`productId` phải là UUID hợp lệ; sai định dạng trả 422. Response giống item của list, thêm ba trường
và mở rộng `media`:

```json
{
  "data": {
    "id": "94458c5e-3f04-49c2-917e-bbcdb35eda14",
    "name": "HTTP Verify Product",
    "slug": "http-verify-product",
    "shortDescription": "snapshot short description",
    "publisher": { "username": "pub634f2966", "displayName": "Publisher Smoke" },
    "currentRelease": {
      "id": "7abb2b89-08ba-42a1-9c29-cd62d3e64c26",
      "version": "2.0.1",
      "publishedAt": "2026-11-19T04:42:21.804Z",
      "minimumLauncherVersion": "0.4.0",
      "minimumRuntimeVersion": "0.5.0"
    },
    "minimumSubscriptionOffer": { "priceAmount": "100000", "durationDays": 7 },
    "media": [
      { "id": "...", "staticId": "...", "type": "COVER", "sortOrder": 0, "altText": null },
      { "id": "...", "staticId": "...", "type": "GALLERY", "sortOrder": 2, "altText": null },
      { "id": "...", "staticId": "...", "type": "ICON", "sortOrder": 0, "altText": "icon alt" }
    ],
    "description": "snapshot long description",
    "usageInstructions": "snapshot usage instructions",
    "offers": [
      { "id": "cb7bc575-...", "type": "ONE_TIME", "durationDays": null, "priceAmount": "9007199254740993" },
      { "id": "b7e727c4-...", "type": "SUBSCRIPTION", "durationDays": 7, "priceAmount": "100000" },
      { "id": "308d8aa5-...", "type": "SUBSCRIPTION", "durationDays": 30, "priceAmount": "100000" }
    ]
  },
  "statusCode": 200
}
```

| Trường | Ghi chú |
| --- | --- |
| `usageInstructions` | có thể `null` |
| `offers` | toàn bộ gói đang bán, thứ tự: theo `type`, rồi `durationDays` tăng dần, gói vĩnh viễn cuối |
| `offers[].durationDays` | `null` nghĩa là vĩnh viễn (chỉ gặp ở `ONE_TIME`) |
| `media` | đầy đủ `ICON`, `COVER`, `GALLERY` |

**404 `Error.ProductNotFound`** trả về cho cả sản phẩm không tồn tại lẫn sản phẩm không đủ điều kiện
công khai. API cố ý không phân biệt hai trường hợp, nên đừng suy đoán trạng thái từ phía client.

Một sản phẩm chỉ xuất hiện công khai khi thỏa **tất cả**: đang `ACTIVE`, publisher còn hoạt động,
có release hiện tại đã `PUBLISHED` và chưa bị gỡ, release đó gắn với submission đã được duyệt, và
còn ít nhất một gói `SUBSCRIPTION` đang bán. Thiếu một điều kiện là sản phẩm biến mất khỏi cả list
lẫn detail.

## 4. Hiển thị ảnh

API chỉ trả `staticId`, không trả URL. FE tự dựng link:

```http
GET /statics/images/{staticId}?variant=small|medium|large
```

| Variant | Kích thước | Dùng cho |
| --- | --- | --- |
| `small` | cạnh dài tối đa 128px | icon, avatar |
| `medium` | cạnh dài tối đa 800px | ảnh card, ảnh trong gallery |
| `large` | ảnh gốc đã convert WebP, không giới hạn | xem ảnh phóng to |

Không truyền `variant` thì mặc định là `large` — **luôn truyền tường minh**, đừng để card tải ảnh gốc.

Ảnh luôn trả về `image/webp`. Response kèm:

```
Cache-Control: public, max-age=31536000, immutable
ETag: "<staticId>:<variant>"
```

Một `staticId` + variant trỏ tới một ảnh bất biến (upload lại sẽ sinh `staticId` mới), nên cứ cache
thoải mái, không cần cache-busting query.

Ví dụ dùng trong React:

```jsx
const cover = product.media.find((m) => m.type === "COVER") ?? product.media[0];

{cover && (
  <img
    src={`${BASE_URL}/statics/images/${cover.staticId}?variant=medium`}
    alt={cover.altText ?? product.name}
  />
)}
```

Sản phẩm có thể không có ảnh nào — luôn xử lý mảng rỗng.

## 5. Trang publisher

```http
GET /marketplace/publishers/{username}
```

Dùng `publisher.username` lấy từ product để dựng link tới trang publisher.

```json
{
  "data": {
    "username": "pub634f2966",
    "fullName": "Publisher Smoke",
    "avatarStaticId": null,
    "bio": null,
    "website": null,
    "twitter": null,
    "linkedin": null,
    "github": null,
    "instagram": null,
    "email": "pub_634f2966@example.com"
  },
  "statusCode": 200
}
```

`avatarStaticId` dùng chung đường tải ảnh ở mục 4. Mọi trường trừ `username`, `fullName`, `email`
đều có thể `null`. Không tìm thấy trả 404 `Error.PublicPublisherNotFound`.

Lưu ý: response này có `email` của publisher. Chỉ hiển thị khi thiết kế thật sự cần.

## 6. Bảng mã lỗi

| HTTP | `message` | Khi nào |
| --- | --- | --- |
| 404 | `Error.ProductNotFound` | product không tồn tại **hoặc** không đủ điều kiện công khai |
| 404 | `Error.PublicPublisherNotFound` | username không tồn tại hoặc publisher đã bị khóa |
| 404 | `Error.StaticNotFound` | `staticId` không tồn tại |
| 422 | `Invalid UUID` | `productId` / `staticId` sai định dạng |
| 422 | `Unrecognized key: "x"` | gửi query param không có trong hợp đồng |
| 422 | `Too big: expected number to be <=100` | `limit` vượt 100 |
| 422 | `Error.InvalidImageVariant` | `variant` không thuộc `small` / `medium` / `large` |

## 7. Lưu ý khi ghép nối

**`priceAmount` là chuỗi, không phải số.** Giá lưu dạng BigInt và có thể vượt
`Number.MAX_SAFE_INTEGER`, nên API trả về dạng chuỗi thập phân. Đừng `parseInt`/`Number()` rồi tính
toán — dùng `BigInt` hoặc thư viện decimal, chỉ format khi hiển thị.

**Đơn vị tiền là VND, không có phần lẻ.** `"100000"` nghĩa là 100.000đ. Offer không có field
`currency` — toàn hệ thống dùng một đơn vị, thống nhất với số dư ví nạp qua SePay.

**`offers` chỉ có ở detail.** Màn list chỉ có `minimumSubscriptionOffer`; muốn hiện đủ bảng giá thì
phải gọi detail.

**Dữ liệu text đến từ bản đã duyệt.** `name`, `slug`, `shortDescription`, `description`,
`usageInstructions` và `media` lấy từ snapshot của submission đã được admin duyệt, không phải bản
publisher đang sửa. Publisher đổi nội dung thì ngoài marketplace vẫn giữ bản cũ cho tới khi
submission mới được duyệt.

**Hiện tại list trả rỗng trên staging.** Database chưa có sản phẩm nào `ACTIVE` kèm gói
`SUBSCRIPTION`, nên `items: []` là đúng, không phải lỗi API.

**Không có endpoint đọc offer riêng.** Sau khi publisher sửa giá, màn hình cần gọi lại product
detail để lấy dữ liệu mới.
