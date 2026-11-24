# Quickstart: verify chia tiền bán hàng (phase 2)

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **API**: [contracts/commission-split-api.md](./contracts/commission-split-api.md)

Toàn bộ chạy trên **database local**, không đụng Cloud SQL.

## 0. Chuẩn bị

```bash
npm install && npm run compose-up
npm run prisma:generate && npm run prisma:migrate:deploy
npm run seed:roles && npm run seed:permissions && npm run seed:settings
npm run build && npm run start:prod
```

### Ba cái bẫy đã biết

**Bẫy 1 — `.env` trỏ nhầm database.** `POSTGRES_HOST` và `DATABASE_URL` phải cùng trỏ local. Ứng
dụng và Prisma CLI đều dùng `DATABASE_URL`; `POSTGRES_HOST` chỉ được khai báo chứ không dùng để kết
nối, nhưng để lệch vẫn gây nhầm lẫn khi đọc.

```bash
grep -E "^(POSTGRES_HOST|POSTGRES_DB|DATABASE_URL)=" .env
```

Mặc định local: database `a2matex_dev`, user `a2matex_dev`, container `a2matex-postgres`.

**Bẫy 2 — `npm run start:dev` không xác thực DTO.** `tsx` không emit decorator metadata nên
validation không chạy. Mọi kịch bản dưới đây chạy trên bản `dist`.

**Bẫy 3 — database local có drift sẵn** (`Static.publisherAccountId`). `prisma migrate dev` sẽ đòi
reset. Dùng migration viết tay + `migrate deploy`, và sửa `schema.prisma` bằng tay chứ không
introspect.

Chuẩn bị biến dùng chung:

```bash
B=http://localhost:9999/api/v1
pg(){ docker exec -i a2matex-postgres psql -U a2matex_dev -d a2matex_dev -tAc "$1"; }
```

Cần ba tài khoản: một **quản trị viên**, và hai tài khoản vừa là **nhà phát hành** vừa là **khách**
(để chạy kịch bản mua chéo ở §6). Lấy token bằng `POST /auth/login` với trường `account`, **không
phải** `email`.

---

## 1. Migration và chuyển đổi dữ liệu cũ (FR-016, FR-016b)

```bash
pg 'SELECT count(*) FROM "Order" WHERE "publisherUserId" IS NULL;'
```

**Kỳ vọng**: `0` — mọi đơn cũ đã được điền.

```bash
pg 'SELECT "commissionAmount" + "publisherAmount" = "totalAmount" AS khop, count(*)
    FROM "Order" GROUP BY 1;'
```

**Kỳ vọng**: chỉ một dòng, `khop = t`.

Mọi đơn cũ phải ghi toàn bộ về phía sàn (quyết định đã chốt: đều là giao dịch thử):

```bash
pg 'SELECT "commissionRateBps", "publisherAmount", count(*)
    FROM "Order" WHERE "paidAt" < '"'"'2026-11-24'"'"' GROUP BY 1,2;'
```

**Kỳ vọng**: chỉ một dòng, `commissionRateBps = 10000` và `publisherAmount = 0`.

Và không ví nào bị migration đụng vào — ghi lại số dư trước khi chạy migration rồi đối chiếu sau:

```bash
pg 'SELECT "userId", balance FROM "Profile" ORDER BY "userId";'
```

**Kỳ vọng**: giống hệt trước và sau. Migration này **không được** chứa câu `UPDATE "Profile"` nào.

---

## 2. Số học chia tiền (FR-001, FR-002, FR-003)

Chạy riêng bộ test số học, nhanh hơn thử qua HTTP:

```bash
npx vitest run src/routes/order/test/ src/routes/publisher-earning/test/
```

**Kỳ vọng**: pass, và bao đủ bảng giá trị ở [data-model.md](./data-model.md) mục 6 — đặc biệt
`100 / 2900 → 29` (ca mà số thực cho 28) và các mức giá không chia hết.

---

## 3. Mua một đơn: tiền chạy đúng (US1, SC-001)

Ghi lại số dư trước:

```bash
pg "SELECT \"userId\", balance FROM \"Profile\" WHERE \"userId\" IN ('<khach>','<publisher>');"
```

Mua, rồi đọc lại số dư và đơn vừa tạo.

**Kỳ vọng** với giá 100.000 ₫ và tỉ lệ 30%:

| | thay đổi |
|---|---|
| ví khách | **−100.000** |
| ví nhà phát hành | **+70.000** |
| `commissionAmount` trên đơn | 30.000 |
| `publisherAmount` trên đơn | 70.000 |

Tổng hai phần phải bằng đúng `totalAmount`.

---

## 4. Thất bại thì không ví nào đổi (FR-006, SC-004)

Mua với số dư không đủ:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/orders \
  -H "Authorization: Bearer $KHACH_NGHEO" -H 'Content-Type: application/json' \
  -d '{"productOfferId":"<offer-dat>"}'
```

**Kỳ vọng**: lỗi số dư như hiện tại, và **ví nhà phát hành không đổi một đồng nào**. Đây là chỗ dễ
sai nhất: cộng ví nhà phát hành trước khi kiểm số dư khách.

---

## 5. Chặn tự mua (FR-012, US1 kịch bản 6)

Đăng nhập bằng chính nhà phát hành rồi mua sản phẩm của mình:

```bash
curl -s -X POST $B/orders -H "Authorization: Bearer $PUBLISHER" \
  -H 'Content-Type: application/json' -d '{"productOfferId":"<offer-cua-chinh-minh>"}' | head -c 200
```

**Kỳ vọng**: `409 Error.CannotPurchaseOwnProduct`, và số dư của họ **không đổi** — không trừ rồi
cộng lại.

---

## 6. Hai nhà phát hành mua chéo nhau cùng lúc (FR-008, SC-005)

Đây là kịch bản mà thứ tự khoá tồn tại để xử lý. Hai lệnh chạy **song song**:

```bash
curl -s -o /dev/null -w 'A:%{http_code}\n' -X POST $B/orders \
  -H "Authorization: Bearer $PUB_A" -H 'Content-Type: application/json' \
  -d '{"productOfferId":"<offer-cua-B>"}' &
curl -s -o /dev/null -w 'B:%{http_code}\n' -X POST $B/orders \
  -H "Authorization: Bearer $PUB_B" -H 'Content-Type: application/json' \
  -d '{"productOfferId":"<offer-cua-A>"}' &
wait
```

**Kỳ vọng**: cả hai trả `201`. Không được có lệnh nào treo hay báo deadlock.

Kiểm log không có `deadlock detected`:

```bash
docker logs a2matex-postgres 2>&1 | grep -ci "deadlock" || echo 0
```

**Kỳ vọng**: `0`.

---

## 7. Hai khách mua cùng lúc từ một nhà phát hành (edge case)

```bash
for t in "$KHACH_1" "$KHACH_2"; do
  curl -s -o /dev/null -X POST $B/orders -H "Authorization: Bearer $t" \
    -H 'Content-Type: application/json' -d '{"productOfferId":"<offer>"}' &
done; wait
```

**Kỳ vọng**: số dư nhà phát hành tăng đúng **tổng của hai lần**, không mất lần nào.

---

## 8. Mua lặp lại chỉ cộng một lần (FR-009, SC-006)

Gửi hai lần cùng một `Idempotency-Key`:

```bash
K=$(uuidgen)
for i in 1 2; do
  curl -s -o /dev/null -w "lan$i:%{http_code}\n" -X POST $B/orders \
    -H "Authorization: Bearer $KHACH" -H "Idempotency-Key: $K" \
    -H 'Content-Type: application/json' -d '{"productOfferId":"<offer>"}'
done
```

**Kỳ vọng**: chỉ một đơn được tạo, và ví nhà phát hành **chỉ tăng một lần**.

---

## 9. Thiếu cấu hình hoa hồng thì từ chối (FR-004)

```bash
pg "UPDATE \"SystemSetting\" SET value='{\"sai\":1}' WHERE key='COMMISSION_RATE_BPS';"
```

Lưu ý: ứng dụng đang chạy sẽ không chết (kiểm tra chỉ chạy lúc khởi động), nhưng lần mua kế tiếp
phải từ chối.

**Kỳ vọng**: `503 Error.CommissionRateUnavailable`, ví khách **không đổi**. Tuyệt đối không được
tự chọn một tỉ lệ thay thế.

Khôi phục:

```bash
pg "UPDATE \"SystemSetting\" SET value='{\"rateBps\": 3000}' WHERE key='COMMISSION_RATE_BPS';"
```

---

## 10. Giá 0 (FR-011)

Mua một sản phẩm miễn phí.

**Kỳ vọng**: đơn được tạo với `commissionAmount = 0`, `publisherAmount = 0`, và **không ví nào
thay đổi**.

---

## 11. Biên của tỉ lệ (Edge cases)

Đặt tỉ lệ `0` rồi mua: nhà phát hành nhận **toàn bộ**, sàn giữ 0.
Đặt tỉ lệ `10000` rồi mua: sàn giữ **toàn bộ**, ví nhà phát hành **không đổi**.

Nhớ trả tỉ lệ về `3000` sau khi thử.

---

## 12. Lịch sử không đổi khi đổi tỉ lệ (US3, SC-007)

Ghi lại `commissionRateBps` và hai số tiền của một đơn, đổi tỉ lệ sang `2500`, đọc lại đơn cũ.

**Kỳ vọng**: con số của đơn cũ **y nguyên**. Đơn mua kế tiếp áp `2500`.

---

## 13. Màn doanh thu (US2, SC-008, SC-010)

```bash
curl -s "$B/publisher-earnings" -H "Authorization: Bearer $PUBLISHER" | jq '.data.items[0], .data.totalItems'
curl -s "$B/publisher-earnings/summary" -H "Authorization: Bearer $PUBLISHER" | jq '.data'
```

**Kỳ vọng**:
- Mỗi dòng có đủ giá khách trả, phần sàn giữ, phần thực nhận, tên sản phẩm, thời điểm.
- `netAmount` trong summary **khớp tổng** cột `publisherAmount` của danh sách.
- `grossAmount = commissionAmount + netAmount`.

Kiểm cách ly giữa hai nhà phát hành:

```bash
curl -s "$B/publisher-earnings" -H "Authorization: Bearer $PUB_B" | jq '.data.totalItems'
```

**Kỳ vọng**: chỉ đếm đơn của chính B. Không có tham số nào cho phép xem của A — thử thêm
`?publisherUserId=<id-cua-A>` phải **không** đổi kết quả.

Người chưa bán gì:

```bash
curl -s "$B/publisher-earnings/summary" -H "Authorization: Bearer $KHACH_THUONG" | jq '.data.orderCount'
```

**Kỳ vọng**: `0`, không phải lỗi.

---

## 14. Phân quyền (FR-021, FR-022)

```bash
curl -s -o /dev/null -w '%{http_code}\n' "$B/publisher-earnings"
```

**Kỳ vọng**: `401` khi không có token.

```bash
pg "SELECT method, path FROM \"Permission\"
    WHERE path LIKE '%publisher-earnings%' AND \"deletedAt\" IS NULL ORDER BY path;"
```

**Kỳ vọng**: 2 dòng. Nếu nhà phát hành nhận `403` thì chưa chạy `seed:permissions`, hoặc cache
chưa được xoá.

**Xoá cache bằng tay phải dùng đúng tên key** — Redis có namespace prefix mà hằng số trong code
không thể hiện:

```bash
docker exec a2matex-redis redis-cli --scan --pattern '*role_permissions:*'
```

Pattern `role_permissions:*` (thiếu `*` đầu) sẽ khớp **0 key** và trông như đã sạch.

---

## 15. Doanh thu sàn (FR-020, SC-009)

```bash
pg 'SELECT count(*), SUM("commissionAmount") FROM "Order";'
```

**Kỳ vọng**: ra được con số mà không cần nguồn dữ liệu nào khác.

---

## 16. Cổng chất lượng

```bash
npm run lint && npm test && npm run build
docker build -t a2matex-verify .
```

Cả bốn phải pass. `docker build` **bắt buộc**: nó cài lại dependency từ đầu và từng gãy vì xung đột
`cron` trong khi `npm run build` ở local vẫn xanh.

---

## Tổng kết nghiệm thu

| # | Kiểm tra | Yêu cầu |
|---|----------|---------|
| 1 | Đơn cũ đã điền, tổng khớp, đơn tự mua không được chia | FR-016, FR-016b, FR-002 |
| 2 | Số học chia tiền đúng ở mọi ca biên | FR-001, FR-003 |
| 3 | Tiền chạy đúng hai chiều khi mua | SC-001 |
| 4 | Mua thất bại không đổi ví nào | FR-006, SC-004 |
| 5 | Chặn tự mua | FR-012 |
| 6 | Mua chéo đồng thời không kẹt | FR-008, SC-005 |
| 7 | Hai khách đồng thời cộng đủ hai lần | Edge case |
| 8 | Mua lặp chỉ cộng một lần | FR-009, SC-006 |
| 9 | Thiếu cấu hình thì từ chối, không mặc định | FR-004 |
| 10 | Giá 0 không đụng ví | FR-011 |
| 11 | Tỉ lệ 0% và 100% | Edge cases |
| 12 | Đổi tỉ lệ không sửa đơn cũ | FR-014, SC-007 |
| 13 | Màn doanh thu đúng và cách ly | FR-017, FR-018, FR-019, SC-008, SC-010 |
| 14 | Phân quyền và cache | FR-021, FR-022 |
| 15 | Doanh thu sàn tính được | FR-020, SC-009 |
| 16 | lint + test + build + **docker build** | Nguyên tắc IV |
