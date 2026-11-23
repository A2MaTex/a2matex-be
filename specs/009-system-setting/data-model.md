# Data Model: System Setting (phase 1)

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Quyết định**: [research.md](./research.md)

## 1. Thực thể `SystemSetting`

Một dòng cho mỗi khóa cấu hình. Dòng do migration tạo ra, sau đó chỉ được sửa — không có đường
tạo mới hay xoá qua ứng dụng, vì tập khóa do registry phía mã nguồn quy định chứ không do dữ liệu.

```text
SystemSetting
  id UUID PK
  key VARCHAR(100), required, unique          -- tên khóa, phải có trong registry
  value JSONB, required                       -- hình dạng do registry quy định
  createdAt TIMESTAMPTZ, required
  updatedAt TIMESTAMPTZ, nullable             -- null = chưa ai sửa kể từ khi migration tạo
  updatedById UUID FK User, nullable
  auditHistory JSONB, required, default []    -- mảng, chỉ thêm
```

Không có `deletedAt`: xoá mềm một dòng cấu hình sẽ tạo ra trạng thái "khóa đã khai báo nhưng không
có dòng", đúng thứ mà kiểm tra lúc khởi động coi là lỗi chí mạng. Không có `createdById` vì dòng
do migration sinh ra, không có người tạo.

### Bất biến

- `key` luôn nằm trong registry. Tầng ứng dụng kiểm tra trước mọi thao tác đọc/ghi.
- `value` luôn parse được theo Zod schema của chính `key` đó. Kiểm tra lúc khởi động (R1) là chốt
  chặn cuối, chạy trước khi nhận request đầu tiên.
- `auditHistory` chỉ dài thêm. Không có đường sửa hay cắt bớt trong ứng dụng.
- `updatedAt` và `updatedById` hoặc cùng null, hoặc cùng khác null.

## 2. Một phần tử `auditHistory`

```jsonc
{
  "at": "2026-11-23T10:15:00.000Z",   // thời điểm sửa
  "by": "<uuid của admin>",           // người sửa
  "from": { "value": "0123456789" },  // giá trị trước, nguyên dạng JSON
  "to":   { "value": "9876543210" }   // giá trị sau
}
```

Lưu nguyên giá trị trước và sau chứ không lưu "đã đổi trường nào": giá trị là JSON tuỳ khóa, và
một bản ghi tự đủ nghĩa thì đọc lại sau nhiều tháng vẫn hiểu được mà không cần biết schema lúc đó.

## 3. Registry — khai báo khóa ở phía mã nguồn

Không nằm trong database. Đây là thứ khiến **thêm một khóa mới** là thay đổi mã nguồn có review,
còn **đổi giá trị** thì không cần.

| Khóa | Zod schema | Giá trị migration seed | Mô tả |
|------|-----------|------------------------|-------|
| `COMMISSION_RATE_BPS` | `z.object({ rateBps: z.number().int().min(0).max(10000) })` | `{"rateBps": 3000}` | Tỉ lệ hoa hồng sàn giữ lại, tính bằng basis point. 3000 = 30%. |
| `SEPAY_BANK_ACCOUNT_NUMBER` | `z.object({ value: z.string().max(50) })` | `{"value": ""}` | Số tài khoản nhận tiền nạp |
| `SEPAY_BANK_NAME` | `z.object({ value: z.string().max(255) })` | `{"value": ""}` | Tên ngân hàng |
| `SEPAY_BANK_ACCOUNT_HOLDER` | `z.object({ value: z.string().max(255) })` | `{"value": ""}` | Tên chủ tài khoản |

Chuỗi rỗng **hợp lệ** ở tầng schema. Đó là chủ ý: migration phải tạo được dòng trước khi ai đó có
giá trị để điền (R6). Việc từ chối giá trị rỗng là trách nhiệm của bên đọc — `topup.service.ts:48`
đã có sẵn guard này và ném `Error.SepayBankTransferNotConfigured`.

Mỗi mục trong registry mang đủ: schema, mô tả bằng lời, và mô tả kiểu để giao diện dựng ô nhập
(FR-009). Thêm khóa ở đây là đủ để nó xuất hiện trong API danh sách, không phải sửa chỗ nào khác.

## 4. Hợp đồng SQL

```sql
CREATE TABLE "SystemSetting" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(100) NOT NULL UNIQUE,
    value JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ,
    "updatedById" UUID
        REFERENCES "User" (id) ON DELETE NO ACTION,
    "auditHistory" JSONB NOT NULL DEFAULT '[]',
    CONSTRAINT "SystemSetting_value_object_check"
        CHECK (jsonb_typeof(value) = 'object'),
    CONSTRAINT "SystemSetting_auditHistory_array_check"
        CHECK (jsonb_typeof("auditHistory") = 'array'),
    CONSTRAINT "SystemSetting_updatedBy_check" CHECK (
        ("updatedAt" IS NULL) = ("updatedById" IS NULL)
    ),
    -- Khóa duy nhất đụng tới tiền. Xác thực ở tầng ứng dụng là chưa đủ: giá trị sai
    -- không được vào được kể cả khi ghi thẳng bằng SQL.
    CONSTRAINT "SystemSetting_commissionRate_check" CHECK (
        key <> 'COMMISSION_RATE_BPS'
        OR ((value ->> 'rateBps')::int BETWEEN 0 AND 10000)
    )
);

INSERT INTO "SystemSetting" (key, value) VALUES
    ('COMMISSION_RATE_BPS',        '{"rateBps": 3000}'),
    ('SEPAY_BANK_ACCOUNT_NUMBER',  '{"value": ""}'),
    ('SEPAY_BANK_NAME',            '{"value": ""}'),
    ('SEPAY_BANK_ACCOUNT_HOLDER',  '{"value": ""}');
```

Không có index nào ngoài `UNIQUE(key)` đã kèm theo. Bảng ở quy mô vài chục dòng và mọi truy vấn
đều đi qua `key`.

`SystemSetting_commissionRate_check` chặn được giá trị *ngoài khoảng* nhưng không chặn được giá
trị *thiếu trường* `rateBps` — khi đó `(value->>'rateBps')::int` là `NULL`, và `NULL BETWEEN` cho
`NULL` nên constraint coi như không vi phạm. Phần đó do Zod chặn. Ghi rõ ở đây để không ai hiểu
nhầm rằng database đã bao hết (R4).

## 5. Mô hình Prisma

```prisma
model SystemSetting {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  key          String    @unique @db.VarChar(100)
  value        Json
  createdAt    DateTime  @default(now()) @db.Timestamptz(6)
  updatedAt    DateTime? @db.Timestamptz(6)
  updatedById  String?   @db.Uuid
  auditHistory Json      @default("[]")
  updatedBy    User?     @relation("SystemSettingUpdatedBy", fields: [updatedById], references: [id], onDelete: NoAction, onUpdate: NoAction)
}
```

`User` nhận thêm quan hệ ngược `updatedSystemSettings SystemSetting[] @relation("SystemSettingUpdatedBy")`.

Theo quy trình SQL-first của repo: viết migration trước bằng
`npm run prisma:migrate:create`, sửa file SQL cho khớp mục 4, rồi để quy trình introspect/generate
cập nhật `schema.prisma`. Không sửa tay file sinh ra trong `src/generated/prisma`.

## 6. Quan hệ với thực thể có sẵn

- **`User`** — chỉ một quan hệ, `updatedById`, để truy vết ai sửa. Không có quan hệ nào khác.
- **Không có quan hệ tới `Product`, `Order`, `Profile`.** Cấu hình là dữ liệu vận hành toàn cục,
  không gắn với bản ghi nghiệp vụ nào.
- **`TopUpTransaction`** không đổi. Chỉ đường *đọc* cấu hình ngân hàng trong `TopUpService` đổi
  nguồn; dữ liệu giao dịch nạp tiền không liên quan.

## 7. Chuyển trạng thái

Một dòng cấu hình chỉ có hai trạng thái, phân biệt bằng `updatedAt`:

```text
[migration tạo]  →  chưa từng sửa   (updatedAt = null, auditHistory = [])
                         │
                         │ admin PATCH
                         ▼
                    đã sửa          (updatedAt, updatedById khác null, auditHistory dài thêm 1)
                         │
                         └── admin PATCH tiếp → vẫn "đã sửa", auditHistory dài thêm
```

Không có trạng thái xoá, không có trạng thái chờ duyệt, không có hiệu lực theo lịch. Lịch hiệu lực
tương lai đã được loại rõ trong mục Out of Scope của spec.
