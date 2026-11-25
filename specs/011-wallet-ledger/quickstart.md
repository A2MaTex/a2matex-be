# Quickstart: Kiểm chứng sổ cái ví và tài khoản tiền của sàn

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Data model**: [data-model.md](./data-model.md) · **API**: [contracts/wallet-ledger-api.md](./contracts/wallet-ledger-api.md)

Hướng dẫn chạy và kiểm, không phải hướng dẫn viết. Chi tiết cài đặt nằm ở `tasks.md`.

## Điều kiện bắt buộc

**Chạy trên database local, không phải Cloud SQL.** Kiểm cẩn thận trước khi gõ lệnh đầu tiên:

```bash
grep -E '^(DATABASE_URL|POSTGRES_HOST)=' .env
```

`DATABASE_URL` **phải** trỏ `localhost`. Đã từng có lần `.env` có `POSTGRES_HOST` trỏ Cloud SQL
trong khi `DATABASE_URL` trỏ localhost — hai biến lệch nhau, và lệnh chạy vào nhầm database.

**Chạy bản `dist`, không phải `start:dev`.** `start:dev` dùng `tsx`, không emit decorator metadata
nên **DTO không được validate**. Kiểm trên `start:dev` sẽ bỏ lọt toàn bộ phần kiểm đầu vào ở mục 4
và 5 dưới đây.

```bash
npm run compose-up
npm run prisma:generate
npm run build          # BẮT BUỘC — mọi bước dưới chạy trên dist
```

## 0. Trên máy local: không phải làm gì

Bản ngày 2026-11-24 có một bước dọn dữ liệu chạy tay trước migration. **Đã bỏ** — xem
[data-model.md](./data-model.md) mục 6.1.

Database local không có khoản số dư nào không giải thích được, nên `migrate deploy` chạy thẳng và
hai chốt dừng đi qua bình thường.

**Riêng production** có một bước ghi lại 15.994.000 ₫ quản trị viên đã cấp cho hai ví có thật. Bước
đó **không nằm trong repo** (hardcode UUID người dùng thật) — nó ở `prod-apply.local.sql`, chạy một
lần theo `docs/deployment-runbook.md` mục B9.1. Không liên quan tới việc kiểm trên máy local.

## 1. Migration

```bash
npm run prisma:migrate:deploy
```

**Phải thành công trọn vẹn.** Nếu migration dừng kèm `RAISE EXCEPTION` thì đó là chốt dừng đang làm
việc — đọc danh sách tài khoản nó in ra, xử lý, rồi chạy lại. **Không** sửa migration để nó đi qua.

Kiểm ngay sau khi chạy:

```bash
docker compose -f tools/docker-compose.yaml exec -T postgres \
  psql -U postgres -d a2matex -c "\d \"WalletTransaction\"" -c "TABLE \"SystemAccount\";"
```

Mong đợi: bảng có đủ 6 ràng buộc `CHECK` ở [data-model.md](./data-model.md) mục 4, 5 index, và
`SystemAccount` có đúng một dòng `PLATFORM_REVENUE`.

**Chạy lại migration lần hai** trên cùng database để kiểm FR-023 — không dòng nào bị nhân đôi.

## 2. Đối soát sau migration — 4 phép, tất cả phải ra 0 dòng

Chạy cả bốn truy vấn (a) (b) (c) (d) ở [data-model.md](./data-model.md) mục 7.

| Phép | Ra 0 dòng nghĩa là |
|---|---|
| (a) | mọi ví người dùng khớp lịch sử — SC-001 |
| (b) | tài khoản của sàn khớp lịch sử |
| (c) | mọi đơn có ba bút toán khớp ba cột trên chính đơn — SC-012 |
| (d) | chưa có lần chuyển khoản nào (database sạch) hoặc mọi lần đều cân |

Rồi chạy truy vấn (e). Trên database local sạch, `tien_tu_phat_hanh` phải bằng **0** — chưa ai bơm
tiền vào tài khoản của sàn.

## 3. Luồng mua hàng sinh ba bút toán

```bash
npm run start:prod
```

Nạp tiền cho một tài khoản khách, rồi mua một sản phẩm có tỉ lệ hoa hồng khác 0.

Kiểm:

```sql
SELECT type, direction, amount, "balanceAfter", "userId", "systemAccount"
FROM "WalletTransaction" WHERE "orderId" = '<id đơn vừa tạo>' ORDER BY type;
```

Mong đợi **đúng ba dòng**:

| type | direction | tài khoản | số tiền |
|---|---|---|---|
| `COMMISSION` | CREDIT | `systemAccount` | phần hoa hồng |
| `EARNING` | CREDIT | `userId` nhà phát hành | phần publisher |
| `PURCHASE` | DEBIT | `userId` khách | nguyên giá |

Và `PURCHASE = EARNING + COMMISSION`. Chạy lại đối soát (c) — vẫn 0 dòng.

**Biến thể phải kiểm**: đơn với tỉ lệ hoa hồng bằng 0 → chỉ sinh **hai** dòng, không có
`COMMISSION` (FR-007).

## 4. Quản trị viên cộng tiền — đường thất bại trước

Kiểm **theo đúng thứ tự này**, vì đường thất bại mới là thứ dễ làm sai.

**4a. Ví sàn không đủ tiền.** Tài khoản của sàn lúc này chỉ có phần hoa hồng từ mục 3 — một số
nhỏ. Gọi `POST /admin/wallet-transactions/grant` với số tiền lớn hơn số đó.

Mong đợi: **422** kèm thông báo nói rõ số dư khả dụng. **Không phải 500.** Nếu ra 500 thì chốt
chặn đang nằm ở `CHECK` của database thay vì ở conditional update — xem
[research.md](./research.md) R12.

Kiểm thêm: không số dư nào thay đổi, không bút toán nào được tạo.

**4b. Đầu vào sai.** `amount` bằng 0, `amount` âm, thiếu `note`, `note` chỉ có khoảng trắng → mỗi
trường hợp một lần gọi, tất cả phải **422**. Đây là phần mà `start:dev` sẽ cho đi qua hết.

**4c. Người nhận đã bị xoá** → 404.

**4d. Người dùng thường gọi route này** → 403.

**4e. Đường thành công.** Bơm tiền vào tài khoản của sàn trước (mục 5), rồi cộng cho một tài khoản.

Mong đợi:

```sql
SELECT type, direction, amount, "userId", "systemAccount", "transferId", note, "createdById"
FROM "WalletTransaction" WHERE "transferId" = '<transferId trả về>';
```

**Đúng hai dòng**, cùng `transferId`, cùng số tiền, ngược chiều nhau — một `DEBIT` ở
`systemAccount`, một `CREDIT` ở `userId`. Cả hai có `note` và `createdById`.

Chạy đối soát (d) — vẫn 0 dòng.

## 5. Quản trị viên bơm tiền vào tài khoản của sàn

Gọi `POST /admin/system-account/issue-credit`.

Kiểm đường thất bại trước: `amount` ≤ 0 → 422; thiếu `note` → 422; người dùng thường → 403.

Đường thành công: số dư `SystemAccount` tăng đúng khoản đó, sinh **một** bút toán `ISSUED_CREDIT`
chiều `CREDIT` với `note` và `createdById`, `transferId` là `NULL`.

Chạy lại truy vấn (e) — `tien_tu_phat_hanh` nay bằng đúng khoản vừa bơm, và **không** lẫn vào
`hoa_hong_thu_duoc` hay `tien_mat_vao`.

Kiểm đẳng thức: `tien_mat_vao + tien_tu_phat_hanh = no_voi_nguoi_dung + so_du_vi_san`.

## 6. Lịch sử ví

`GET /wallet-transactions` với tài khoản vừa nhận tiền ở 4e.

Mong đợi: mới nhất trước; thấy dòng `ADMIN_GRANT` chiều `CREDIT` kèm `note`; **không** thấy chân
`DEBIT` ở tài khoản của sàn; **không** có `COMMISSION` hay `ISSUED_CREDIT` nào; payload không có
`systemAccount` và `transferId`.

Đăng nhập bằng tài khoản khác → chỉ thấy biến động của chính tài khoản đó (SC-006). Thử mọi tham
số query có thể nghĩ ra để lấy ví người khác — không tham số nào làm được.

## 7. Ràng buộc ở tầng dữ liệu

Thử ghi thẳng bằng SQL, **mỗi câu phải bị từ chối**:

```sql
-- số tiền âm
INSERT INTO "WalletTransaction" (...) VALUES (..., -1000, ...);
-- cả hai cột tài khoản cùng rỗng
-- cả hai cột tài khoản cùng có giá trị
-- COMMISSION gắn vào userId thay vì systemAccount
-- ADMIN_GRANT chiều DEBIT gắn vào userId
-- ISSUED_CREDIT không có note
-- TOPUP có transferId
UPDATE "Profile" SET balance = -1 WHERE ...;
UPDATE "SystemAccount" SET balance = -1 WHERE type = 'PLATFORM_REVENUE';
```

Bảy câu đầu vi phạm các `CHECK` ở [data-model.md](./data-model.md) mục 4; hai câu cuối vi phạm ràng
buộc không-âm (SC-008).

## 8. Phát hiện sửa số dư ngoài ứng dụng

Đổi `Profile.balance` của một ví bằng SQL trực tiếp (một giá trị hợp lệ, không âm), chạy đối soát
(a) → **đúng ví đó hiện ra** kèm mức chênh (SC-004).

Làm tương tự với `SystemAccount.balance`, chạy đối soát (b) → nó hiện ra.

Trả lại giá trị cũ, chạy lại cả hai → 0 dòng.

## 9. Cổng chất lượng trước khi mở PR

```bash
npm run lint
npm test
npm run build
docker build -t a2matex-be:wallet-check .
```

**`docker build` không bỏ qua được.** `npm run build` pass trên máy local **không chứng minh gì** về
image — đã có lần build local xanh mà image đỏ vì khác cách giải phụ thuộc. Xem mục Rủi ro của
[plan.md](./plan.md).

## Danh sách kiểm cuối

- [ ] `DATABASE_URL` trỏ localhost, đã đối chiếu cả `POSTGRES_HOST`
- [ ] Chạy trên `dist`, không phải `start:dev`
- [ ] Migration chạy trọn vẹn, chạy lại lần hai không nhân đôi
- [ ] Bốn phép đối soát (a)(b)(c)(d) ra 0 dòng sau migration
- [ ] Một đơn sinh đúng ba bút toán; đơn hoa hồng 0 sinh hai
- [ ] Ví sàn không đủ tiền trả **422**, không phải 500
- [ ] Mọi đầu vào sai đều bị từ chối (kiểm trên `dist`)
- [ ] `ADMIN_GRANT` sinh đúng hai chân cùng `transferId`, cân nhau
- [ ] `ISSUED_CREDIT` hiện thành dòng riêng ở truy vấn (e)
- [ ] Đẳng thức dòng tiền đúng
- [ ] Không xem được lịch sử ví người khác
- [ ] Bảy câu SQL vi phạm ràng buộc đều bị từ chối
- [ ] Sửa số dư ngoài ứng dụng bị đối soát bắt, ở cả hai loại tài khoản
- [ ] `lint`, `test`, `build`, `docker build` đều pass
