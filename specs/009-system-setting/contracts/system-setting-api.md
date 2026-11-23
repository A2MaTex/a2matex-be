# API Contract: System Setting (phase 1)

**Spec**: [../spec.md](../spec.md) · **Data model**: [../data-model.md](../data-model.md)

Tiền tố đường dẫn: `API_PREFIX` (mặc định `api/v1`). Mọi route nằm sau `AccessTokenGuard` và chỉ
role Admin có permission, theo cùng cách `admin/entitlements` và `admin/users` đang làm.

Controller: `@Controller('admin/system-settings')`, gắn `@ApiTags('System Settings')` và
`@ApiBearerAuth('access-token')`.

---

## `GET /api/v1/admin/system-settings`

Trả về **toàn bộ khóa đã khai báo trong registry**, kèm giá trị hiện tại, mô tả và mô tả kiểu dữ
liệu — đủ để Admin Portal dựng form mà không hardcode danh sách (FR-009).

Nguồn danh sách là **registry**, không phải bảng. Nếu một khóa có trong registry mà thiếu dòng
trong bảng thì ứng dụng đã không khởi động được từ đầu (FR-006), nên tình huống đó không tới được
route này.

**Response `200`**

```jsonc
// `items` follows every other list route in the repo; the transform interceptor adds the
// outer `data` wrapper.
{
  "items": [
    {
      "key": "COMMISSION_RATE_BPS",
      "value": { "rateBps": 3000 },
      "description": "Tỉ lệ hoa hồng sàn giữ lại trên mỗi đơn hàng, tính bằng basis point (3000 = 30%)",
      "valueSchema": {
        "type": "object",
        "fields": [
          { "name": "rateBps", "type": "integer", "min": 0, "max": 10000 }
        ]
      },
      "updatedAt": null,
      "updatedById": null
    },
    {
      "key": "SEPAY_BANK_ACCOUNT_NUMBER",
      "value": { "value": "0123456789" },
      "description": "Số tài khoản ngân hàng nhận tiền nạp của khách",
      "valueSchema": {
        "type": "object",
        "fields": [{ "name": "value", "type": "string", "maxLength": 50 }]
      },
      "updatedAt": "2026-11-23T10:15:00.000Z",
      "updatedById": "7f3a…"
    }
  ]
}
```

`valueSchema` là mô tả rút gọn do registry tự khai, **không phải** JSON Schema sinh tự động từ
Zod. Lý do: giao diện chỉ cần đủ thông tin để chọn loại ô nhập và đặt ràng buộc cơ bản; sinh JSON
Schema đầy đủ sẽ kéo thêm phụ thuộc mà chưa ai cần (Nguyên tắc VI).

Không trả `auditHistory` ở route danh sách — xem ghi chú cuối tài liệu.

---

## `PATCH /api/v1/admin/system-settings/:key`

Đổi giá trị của đúng một khóa.

**Path param**: `key` — phải có trong registry.

**Body**

```jsonc
{
  "value": { "rateBps": 2500 }
}
```

`value` được xác thực bằng Zod schema của **chính khóa đó**, lấy từ registry lúc chạy. Không có
schema dùng chung cho mọi khóa.

**Response `200`** — trả về bản ghi sau khi sửa, cùng hình dạng một phần tử của route danh sách.

**Hành vi**

1. Tra `key` trong registry. Không có → `404 Error.SystemSettingKeyNotRegistered`.
2. Parse `value` theo schema của khóa. Hỏng → `422` từ `CustomZodValidationPipe`.
3. Đọc giá trị hiện tại, ghi giá trị mới và append một phần tử `auditHistory` **trong cùng một
   câu lệnh** (R5), kèm `updatedAt = now()` và `updatedById`.
4. Giá trị mới giống hệt giá trị cũ → vẫn trả `200`. Không bắt buộc ghi thêm `auditHistory`; cách
   làm đơn giản nhất là vẫn ghi, và điều đó chấp nhận được.

---

## Lỗi

| Mã | Khi nào | HTTP |
|----|---------|------|
| `Error.SystemSettingKeyNotRegistered` | `key` không có trong registry | 404 |
| lỗi Zod | `value` sai hình dạng so với schema của khóa | 422 |
| `Error.SepayBankTransferNotConfigured` | **đã có sẵn** — bên đọc gặp giá trị ngân hàng rỗng | 503 |

Theo đúng quy ước của repo (`order.error.ts`): hằng số exception đặt ở `system-setting.error.ts`,
thông điệp dạng `Error.<Tên>` để client tự dịch.

Không có mã lỗi riêng cho "khóa có trong registry nhưng thiếu dòng trong bảng": tình huống đó làm
ứng dụng không khởi động được, không bao giờ xuất hiện ở tầng HTTP.

---

## Permission

Hai route sinh ra hai bản ghi `Permission` với `scope = null`:

| Method | Path |
|--------|------|
| `GET` | `/api/v1/admin/system-settings` |
| `PATCH` | `/api/v1/admin/system-settings/:key` |

**Không soạn tay.** `npm run seed:permissions` quét decorator trong mã nguồn, tạo bản ghi, gán cho
role Admin (`create-permissions.ts:262` gán mọi permission `scope: null`), rồi xoá cache
`ROLE_PERMISSION_CACHE_PREFIX` trên Redis (`create-permissions.ts:316`). Chạy seed sau khi
controller đã tồn tại.

---

## Hợp đồng nội bộ cho module khác

Không phải HTTP — đây là mặt tiếp xúc mà `SystemSettingCoreModule` export (FR-019).

```ts
// Đọc có kiểu. Kiểu trả về suy ra từ schema của khóa trong registry,
// nên nơi gọi không phải tự ép kiểu.
get<K extends SettingKey>(key: K): Promise<SettingValue<K>>;
```

Bên tiêu thụ ở phase 1 là `TopUpService.getBankTransferConfig()`, đọc 3 khóa ngân hàng. Hàm này
**chuyển thành `async`** và nơi gọi phải `await` (R8).

Phase 2 sẽ là bên tiêu thụ thứ hai, đọc `COMMISSION_RATE_BPS` bên trong transaction mua hàng.

---

## Những thứ cố ý không có trong phase này

- **Không có `POST`** tạo khóa mới. Tập khóa do registry quy định, thêm khóa là thay đổi mã nguồn
  có review.
- **Không có `DELETE`**. Xoá một dòng sẽ làm ứng dụng không khởi động được ở lần deploy sau.
- **Không có route đọc `auditHistory`.** Lịch sử vẫn được ghi đầy đủ và truy được bằng SQL khi cần
  điều tra; dựng route và giao diện cho nó chưa có nhu cầu thật (Nguyên tắc VI). Khi cần, thêm
  `GET /admin/system-settings/:key/history` mà không phải đổi dữ liệu.
- **Không có đọc hàng loạt theo danh sách khóa.** Registry có 4 khóa; route danh sách trả hết.
