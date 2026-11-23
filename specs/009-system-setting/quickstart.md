# Quickstart: verify System Setting (phase 1)

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **API**: [contracts/system-setting-api.md](./contracts/system-setting-api.md)

Toàn bộ kịch bản chạy trên **database local**, không đụng Cloud SQL.

## 0. Chuẩn bị

```bash
npm install
npm run compose-up            # Postgres + Redis local
npm run prisma:generate
npm run prisma:migrate:deploy
npm run seed:roles
npm run seed:permissions
```

### Hai cái bẫy phải kiểm trước khi chạy

**Bẫy 1 — `.env` trỏ nhầm database.** Kiểm tra `POSTGRES_HOST` và `DATABASE_URL` trong `.env`
cùng trỏ về local. Đã có lần `DATABASE_URL` trỏ `localhost` còn `POSTGRES_HOST` trỏ Cloud SQL,
khiến migration và ứng dụng chạy trên hai database khác nhau.

```bash
grep -E "^(POSTGRES_HOST|POSTGRES_DB|DATABASE_URL)=" .env
```

Mặc định local là database `a2matex_dev`, user `a2matex_dev`, container `a2matex-postgres` — các
lệnh `psql` bên dưới dùng đúng bộ này. Nếu `.env` của bạn khác thì sửa theo.

**Bẫy 2 — `npm run start:dev` không xác thực DTO.** `tsx` không emit decorator metadata, nên
validation của `nestjs-zod` **không chạy** ở chế độ dev. Mọi kịch bản kiểm thử validation dưới đây
PHẢI chạy trên bản build:

```bash
npm run build
npm run start:prod
```

Dùng `start:dev` để verify sẽ cho kết quả sai: giá trị hỏng vẫn được chấp nhận.

Đặt sẵn token admin để tiện gọi:

```bash
ADMIN_TOKEN="<access token của tài khoản admin>"
BASE="http://localhost:3000/api/v1"
```

---

## 1. Migration tạo đủ 4 dòng (FR-013, FR-017, R6)

```bash
docker exec -i a2matex-postgres psql -U a2matex_dev -d a2matex_dev -c \
  'SELECT key, value, "updatedAt" FROM "SystemSetting" ORDER BY key;'
```

**Kỳ vọng**: đúng 4 dòng. `COMMISSION_RATE_BPS` = `{"rateBps": 3000}`, ba khóa `SEPAY_BANK_*` =
`{"value": ""}`, `updatedAt` của cả 4 đều `NULL`.

Thiếu bất kỳ dòng ngân hàng nào là lỗi chí mạng, không phải chuyện nhỏ: container mới sẽ không
khởi động được ở bước 6.

---

## 2. Đọc danh sách cấu hình (FR-009)

```bash
curl -s "$BASE/admin/system-settings" -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

**Kỳ vọng**: 4 mục, mỗi mục có `key`, `value`, `description`, `valueSchema`, `updatedAt`,
`updatedById`. Không có mục nào thiếu `description` hay `valueSchema` — giao diện dựa vào hai
trường đó để dựng ô nhập.

---

## 3. Đổi giá trị và kiểm lịch sử (FR-007, FR-010, R5)

```bash
curl -s -X PATCH "$BASE/admin/system-settings/SEPAY_BANK_ACCOUNT_NUMBER" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"value":{"value":"0123456789"}}' | jq

curl -s -X PATCH "$BASE/admin/system-settings/SEPAY_BANK_ACCOUNT_NUMBER" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"value":{"value":"9876543210"}}' | jq
```

```bash
docker exec -i a2matex-postgres psql -U a2matex_dev -d a2matex_dev -c \
  'SELECT jsonb_array_length("auditHistory") AS n, "auditHistory"
   FROM "SystemSetting" WHERE key = '"'"'SEPAY_BANK_ACCOUNT_NUMBER'"'"';'
```

**Kỳ vọng**: `n = 2`. Phần tử thứ nhất `from.value = ""` → `to.value = "0123456789"`, phần tử thứ
hai `from.value = "0123456789"` → `to.value = "9876543210"`. Mỗi phần tử có `at` và `by`.
`updatedById` trên dòng khớp với id admin đang gọi.

---

## 4. Từ chối khóa lạ và giá trị sai kiểu (FR-003, FR-004)

```bash
# Khóa không có trong registry
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH "$BASE/admin/system-settings/KHONG_TON_TAI" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"value":{"value":"x"}}'

# Sai kiểu: rateBps là chuỗi
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH "$BASE/admin/system-settings/COMMISSION_RATE_BPS" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"value":{"rateBps":"ba muoi"}}'

# Ngoài khoảng
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH "$BASE/admin/system-settings/COMMISSION_RATE_BPS" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"value":{"rateBps":10001}}'
```

**Kỳ vọng**: `404`, `422`, `422`. Sau cả ba lệnh, bảng không có dòng mới và `COMMISSION_RATE_BPS`
vẫn giữ giá trị cũ.

Nhớ: nếu đang chạy `start:dev` thì hai lệnh sau sẽ trả `200` — đó là Bẫy 2, không phải lỗi tính năng.

---

## 5. Chặn ở tầng database (FR-005, SC-004, R4)

Ghi thẳng bằng SQL, bỏ qua ứng dụng:

```bash
docker exec -i a2matex-postgres psql -U a2matex_dev -d a2matex_dev -c \
  'UPDATE "SystemSetting" SET value = '"'"'{"rateBps": -1}'"'"' WHERE key = '"'"'COMMISSION_RATE_BPS'"'"';'
```

**Kỳ vọng**: `ERROR: new row for relation "SystemSetting" violates check constraint
"SystemSetting_commissionRate_check"`.

Thử tiếp giá trị `20000` — cũng phải bị từ chối.

**Lưu ý đã biết**: ghi `'{"foo": 1}'` (thiếu hẳn `rateBps`) sẽ **được chấp nhận** ở tầng database.
Đây là giới hạn đã lường trước của constraint (R4), không phải lỗi; tầng Zod chặn phần đó, và kiểm
tra lúc khởi động ở bước 6 sẽ bắt được nếu dữ liệu đã lỡ hỏng.

---

## 6. Ứng dụng từ chối khởi động khi cấu hình hỏng (FR-006, R1)

```bash
# Xoá một dòng để mô phỏng cấu hình thiếu
docker exec -i a2matex-postgres psql -U a2matex_dev -d a2matex_dev -c \
  'DELETE FROM "SystemSetting" WHERE key = '"'"'SEPAY_BANK_NAME'"'"';'

npm run start:prod   # phải thất bại
```

**Kỳ vọng**: tiến trình dừng với lỗi nêu đích danh khóa thiếu. Không được khởi động rồi mới hỏng
lúc có request.

Thử cả trường hợp giá trị hỏng:

```bash
docker exec -i a2matex-postgres psql -U a2matex_dev -d a2matex_dev -c \
  'UPDATE "SystemSetting" SET value = '"'"'{"khong_co_truong_dung": 1}'"'"' WHERE key = '"'"'COMMISSION_RATE_BPS'"'"';'

npm run start:prod   # cũng phải thất bại
```

Khôi phục rồi chạy tiếp:

```bash
docker exec -i a2matex-postgres psql -U a2matex_dev -d a2matex_dev -c \
  'UPDATE "SystemSetting" SET value = '"'"'{"rateBps": 3000}'"'"' WHERE key = '"'"'COMMISSION_RATE_BPS'"'"';
   INSERT INTO "SystemSetting" (key, value) VALUES ('"'"'SEPAY_BANK_NAME'"'"', '"'"'{"value": "MBBank"}'"'"');'
```

### Cron server cũng phải fail như vậy

```bash
# Lại xoá một dòng
docker exec -i a2matex-postgres psql -U a2matex_dev -d a2matex_dev -c 'DELETE FROM "SystemSetting" WHERE key = '"'"'SEPAY_BANK_NAME'"'"';'

npm run start:cron   # phải thất bại giống app chính
```

Đây là **hành vi mong muốn**, không phải hồi quy: job đối soát SePay không nên chạy với cấu hình
hỏng. Nhớ khôi phục lại dòng sau khi thử.

---

## 7. Route admin KHÔNG được lộ trên cổng cron (R2)

Đây là kiểm thử quan trọng nhất của phase này về mặt bảo mật.

```bash
npm run start:cron &
sleep 5
CRON_PORT=$(grep -E '^CRON_PORT=' .env | cut -d= -f2)
curl -s -o /dev/null -w '%{http_code}\n' \
  "http://localhost:${CRON_PORT}/api/v1/admin/system-settings"
```

Cổng cron đọc từ `CRON_PORT` trong `.env` (`src/cron/main.ts:16`), khác cổng app chính.

**Kỳ vọng**: `404`. Nếu trả `200` hoặc `401` thì `CronModule` đang import nhầm
`SystemSettingModule` (có controller) thay vì `SystemSettingCoreModule` — phải sửa trước khi merge.

Kiểm tra thêm bằng mắt: `src/cron/cron.module.ts` không được import module nào có `controllers`.

**Tiến trình consumer không cần kiểm.** `ConsumerModule` không với tới `TopUpCoreModule` nên
`SystemSettingCoreModule` không bị kéo vào đó (xem research R2). Nếu sau này thêm handler consumer
cần đọc cấu hình thì phải quay lại làm bước 7 cho cả cổng consumer.

---

## 8. Màn hình nạp tiền đọc từ cấu hình (FR-015, FR-018, R8)

Đặt đủ 3 giá trị ngân hàng rồi tạo yêu cầu nạp tiền bằng tài khoản khách:

```bash
curl -s -X POST "$BASE/topups" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"amount":100000}' | jq
```

**Kỳ vọng**: `bankAccountNumber`, `bankName`, `accountHolderName` khớp với giá trị **vừa đặt trong
bảng cấu hình**, không phải giá trị trong `.env`.

Kiểm chứng rằng nó thật sự đọc từ database: đổi số tài khoản qua API admin rồi gọi lại
`POST /topups` **mà không khởi động lại tiến trình** — phải thấy số mới (SC-002).

Giá trị rỗng phải báo lỗi rõ ràng:

```bash
curl -s -X PATCH "$BASE/admin/system-settings/SEPAY_BANK_NAME" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"value":{"value":""}}'

curl -s -X POST "$BASE/topups" -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H 'Content-Type: application/json' -d '{"amount":100000}' | jq
```

**Kỳ vọng**: `503` với `Error.SepayBankTransferNotConfigured`. Tuyệt đối không được trả về chuỗi
rỗng cho khách chuyển tiền.

---

## 9. Phân quyền (FR-011, FR-011b, FR-012)

```bash
# Không có token
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/admin/system-settings"

# Token của khách thường
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/admin/system-settings" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN"
```

**Kỳ vọng**: `401` và `403`.

Nếu admin cũng nhận `403`: chưa chạy `npm run seed:permissions` sau khi thêm controller, hoặc cache
role-permission chưa được xoá. Seed script tự xoá cache ở `create-permissions.ts:316`; nếu Redis
không kết nối được, script in cảnh báo và phải xoá tay.

Kiểm tra permission đã vào bảng:

```bash
docker exec -i a2matex-postgres psql -U a2matex_dev -d a2matex_dev -c \
  'SELECT method, path FROM "Permission" WHERE path LIKE '"'"'%system-settings%'"'"' AND "deletedAt" IS NULL;'
```

**Kỳ vọng**: đúng 2 dòng, `GET` và `PATCH`.

---

## 10. Seed script nạp giá trị từ biến môi trường (FR-014, R7)

Mô phỏng bước 1 của quy trình chuyển đổi:

```bash
# Đưa 3 dòng về rỗng như ngay sau migration
docker exec -i a2matex-postgres psql -U a2matex_dev -d a2matex_dev -c \
  'UPDATE "SystemSetting" SET value = '"'"'{"value": ""}'"'"' WHERE key LIKE '"'"'SEPAY_BANK%'"'"';'

# .env vẫn còn 3 biến SEPAY_BANK_*
npm run seed:settings
```

**Kỳ vọng**: 3 dòng nhận đúng giá trị từ `.env`.

Chạy lại lần hai để kiểm tính an toàn:

```bash
curl -s -X PATCH "$BASE/admin/system-settings/SEPAY_BANK_NAME" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"value":{"value":"Gia tri admin vua sua"}}'

npm run seed:settings
```

**Kỳ vọng**: giá trị admin vừa sửa **không bị ghi đè**. Seed chỉ điền vào dòng đang rỗng.

---

## 11. Cổng chất lượng trước khi mở PR (Nguyên tắc IV)

```bash
npm run lint
npm test
npm run build
```

`npm test` phải bao được ba chỗ mà lỗi xảy ra âm thầm, không lộ ra ở curl: registry từ chối khóa
lạ, parse theo schema từng khóa, và `auditHistory` append đúng một phần tử với `from`/`to` đúng.
Ba file test nằm ở `src/routes/system-setting/test/` theo quy ước repo.

Cả ba phải pass. `oxlint --type-aware` bật `typescript/no-floating-promises` ở mức lỗi, nên nếu
`getBankTransferConfig()` đã thành `async` mà nơi gọi quên `await` thì lint sẽ chặn (R8).

---

## Tổng kết điều kiện nghiệm thu

| # | Kiểm tra | Yêu cầu |
|---|----------|---------|
| 1 | Migration tạo đủ 4 dòng | FR-013, FR-017 |
| 2 | Danh sách trả đủ mô tả và mô tả kiểu | FR-009, SC-008 |
| 3 | Sửa giá trị, lịch sử dài thêm đúng 1 mỗi lần | FR-007, FR-010, SC-005 |
| 4 | Từ chối khóa lạ và giá trị sai kiểu | FR-003, FR-004, SC-003 |
| 5 | Database chặn giá trị ngoài khoảng | FR-005, SC-004 |
| 6 | App và cron đều không khởi động khi cấu hình hỏng | FR-006, SC-006 |
| 7 | Route admin không lộ trên cổng cron | R2 |
| 8 | Nạp tiền đọc từ cấu hình, có hiệu lực ngay | FR-015, FR-018, SC-001, SC-002 |
| 9 | Phân quyền đúng, permission đã seed | FR-011, FR-011b, FR-012 |
| 10 | Seed nạp từ `.env`, không ghi đè giá trị đã có | FR-014, SC-007 |
| 11 | lint + test + build pass | Nguyên tắc IV |
