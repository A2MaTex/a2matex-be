# Quickstart: Verify duyệt đơn rút tiền và xem sổ cái

**Phase 1** · 2026-11-27 · [contracts/withdrawal-admin-api.md](./contracts/withdrawal-admin-api.md)

Hướng dẫn chạy và kiểm chứng. Không chứa mã hiện thực.

---

## Hai điều bắt buộc

**1. Chạy trên `dist`.** `tsx` không emit decorator metadata nên DTO **không được validate** —
mọi ca kiểm input dưới đây sẽ cho qua sai. Luôn `npm run build && node dist/main.js`.

**2. PHẢI chạy seed phân quyền sau khi build.** Khác spec 012: bảy route này gác quyền thật, không
seed thì **quản trị viên cũng nhận 403**.

```bash
npm run build && npm run seed:permissions
```

Test đặt ở `src/routes/withdrawal/test/` và `src/routes/wallet/test/`, **commit tất cả**. Test
import service vẫn chạy được khi không có `.env` nhờ `vi.mock` chặn chuỗi dẫn tới `config.ts` —
thủ phạm là `PrismaService` qua các repo, không phải `system.constant.ts`. Xem research R11.

---

## Chuẩn bị

```bash
docker compose -f tools/docker-compose.yaml up -d postgres redis
npm run prisma:generate && npm run prisma:migrate:deploy
npm run seed:roles && npm run seed:permissions && npm run seed:settings
npm run build && node dist/main.js
```

DB local đã có sẵn từ lần verify spec 012: publisher `pub012@example.com` / `pub012b@example.com`
(mật khẩu `Secret123!`) và Term `PUBLISHER_TERMS`. Cần tạo thêm đơn rút tiền ở nhiều trạng thái.

> `.env` có **hai** biến trỏ hai nơi: `POSTGRES_HOST` là Cloud SQL còn `DATABASE_URL` là localhost.
> Chạy verify nhầm lên Cloud SQL là chạm dữ liệu thật.

---

## Nhóm A — luồng duyệt và chi

| # | Việc làm | Phải thấy | FR |
|---|---|---|---|
| 1 | Admin xem danh sách đơn | thấy đơn kèm **tên và email** publisher, không chỉ mã định danh | 006 |
| 2 | Không truyền bộ lọc trạng thái | thấy **mọi trạng thái**, kể cả `CANCELLED` và `REJECTED` | 005 |
| 3 | Lọc `status=PENDING` | chỉ thấy đơn chờ duyệt | 005 |
| 4 | Duyệt một đơn chờ duyệt | 200, `APPROVED`, ghi người duyệt và thời điểm | 008, 010 |
| 5 | Kiểm số dư publisher sau khi duyệt | **không đổi một đồng** | 011 |
| 6 | Kiểm sổ cái sau khi duyệt | **không có bút toán mới nào** | 011 |
| 7 | Đánh dấu đã chi kèm mã giao dịch | 200, `PAID`, mã giao dịch được lưu | 013, 015 |
| 8 | Kiểm số dư và sổ cái sau khi chi | **vẫn không đổi, vẫn không bút toán mới** | 016 |

---

## Nhóm A — các đường từ chối

Mỗi ca **phải** trả mã nghiệp vụ, **không ca nào được 500** (FR-039).

| # | Việc làm | Phải thấy | FR |
|---|---|---|---|
| 9 | Đánh dấu chi một đơn **chưa duyệt** | 409 `NotApproved` | 014 |
| 10 | Duyệt một đơn **đã duyệt** | 409 `NotPending`, nêu rõ trạng thái hiện tại | 009 |
| 11 | Duyệt / đánh dấu chi một đơn **đã chi** | 409 | 009, 014 |
| 12 | Đánh dấu chi **không có mã giao dịch** | 422 `TransferRefRequired` | 015 |
| 13 | Mã giao dịch chỉ gồm khoảng trắng | 422 — **không được lọt** | Edge |
| 14 | Từ chối **không có lý do** | 422 `RejectionReasonRequired` | 021 |
| 15 | Lý do chỉ gồm khoảng trắng | 422 — không được lọt | Edge |
| 16 | Mã đơn không tồn tại | 404 ở cả ba thao tác | — |
| 17 | **Publisher** gọi bất kỳ route admin nào | 403 | 001 |
| 18 | **Người dùng thường** gọi | 403 | 001 |

---

## Nhóm A — từ chối và hoàn tiền

| # | Việc làm | Phải thấy | FR |
|---|---|---|---|
| 19 | Từ chối đơn **chờ duyệt**, kèm lý do | 200, `REJECTED`, số dư trở về mức trước khi tạo đơn | 018, 022 |
| 20 | Kiểm sổ cái sau khi từ chối | đúng **2** bút toán cho đơn đó, dòng hoàn có **người thực hiện và lý do** | 023 |
| 21 | Từ chối đơn **đã duyệt** | 200, vẫn hoàn tiền | 018 |
| 22 | Từ chối đơn **đã chi** | 409 `CannotReject`, **số dư không đổi** | 019 |
| 23 | Từ chối đơn đã bị từ chối | 409, **không hoàn lần hai** | 020, 024 |
| 24 | Từ chối đơn publisher đã tự huỷ | 409, không hoàn lần hai | 020 |
| 25 | Xoá mềm hồ sơ publisher rồi từ chối | báo lỗi rõ ràng, **trạng thái đơn KHÔNG đổi** | 026 |

Ca 25 là ca dễ sai nhất: nếu đổi trạng thái trước rồi mới phát hiện không hoàn được, đơn sẽ thành
`REJECTED` mà tiền không về ví — mất tiền của publisher.

---

## Nhóm A — chạy song song (SC-004, SC-005)

| # | Việc làm | Phải thấy |
|---|---|---|
| 26 | 5 lệnh **duyệt** cùng một đơn, cùng lúc | đúng 1 thành công, 4 lệnh 409, **không lỗi 500** |
| 27 | 5 lệnh **từ chối** cùng một đơn, cùng lúc | đúng 1 hoàn tiền, 4 lệnh 409; sổ cái đúng **1** dòng hoàn |
| 28 | Duyệt và từ chối cùng lúc | **cả hai có thể cùng 200** — chúng không loại trừ nhau vì từ chối nhận cả đơn đã duyệt. Phải kiểm: trạng thái cuối mạch lạc và **đúng 1** bút toán hoàn |
| 29 | Admin duyệt và publisher tự huỷ cùng lúc | đúng 1 thành công; nếu duyệt thắng thì lệnh huỷ 409 và **tiền không được hoàn** |

Ca 29 kiểm đúng chỗ hai spec gặp nhau. Cả hai đều dùng `UPDATE` có điều kiện trên cùng một dòng
nên database tự xử lý — nếu thấy 500 thì có đường nào đó đã tách thành `SELECT`+`UPDATE`.

---

## Nhóm B — xem sổ cái

| # | Việc làm | Phải thấy | FR |
|---|---|---|---|
| 30 | Xem sổ cái không lọc | mọi bút toán, mới nhất trước | 027 |
| 31 | Lọc theo `userId` | chỉ bút toán của người đó | 028 |
| 32 | Lọc nhiều loại cùng lúc (`ADMIN_GRANT` + `ISSUED_CREDIT`) | đúng hai loại đó | 028 |
| 33 | Lọc khoảng thời gian | chỉ dòng trong khoảng; mốc kết thúc **không bao gồm** | 028 |
| 34 | `from` sau `to` | 422 `DateRangeInvalid` | 029 |
| 35 | `limit=101` | 422 — không âm thầm cắt | 007a |
| 36 | Lật sang trang 2 | **không trùng, không sót dòng** so với trang 1 | 027 |

Ca 36 phải chạy trên dữ liệu có nhiều bút toán **cùng mốc thời gian** — ba bút toán của một đơn
hàng là ví dụ sẵn có. Không có tiêu chí phụ `id` thì ca này sẽ lộ ngay.

---

## Nhóm B — ví một người dùng

| # | Việc làm | Phải thấy | FR |
|---|---|---|---|
| 37 | Xem ví một publisher có cả bán hàng lẫn admin cộng | phân tách đủ cả hai chiều | 030 |
| 38 | **Cộng trừ bảng phân tách** | `totalIn − totalOut` = đúng `balance` | 030a |
| 39 | Xem ví một publisher **từng có đơn bị từ chối** | `WITHDRAWAL_REVERSAL` nằm ở nhóm **vào**, bảng vẫn cân | 030a |
| 40 | Xem ví người chưa từng có biến động | số dư `"0"`, mảng rỗng, **không phải lỗi** | 031 |
| 41 | Mã người dùng không tồn tại | 404 | 032 |

Ca 39 là ca bẫy: bỏ `WITHDRAWAL_REVERSAL` khỏi nhóm vào thì mọi ví từng bị từ chối sẽ hiện ra là
lệch, mà đó đúng là những ví admin hay mở xem nhất.

---

## Nhóm B — bảng đối soát

| # | Việc làm | Phải thấy | FR |
|---|---|---|---|
| 42 | Mở bảng đối soát | đủ 6 con số dòng tiền + 5 phép kiểm | 033, 035 |
| 43 | **Đối chiếu từng con số** với chạy tay truy vấn runbook B9.3 | khớp **tuyệt đối** | 037, SC-009 |
| 44 | Cố tình làm một ví lệch bằng SQL rồi mở lại | phép (a) báo bất thường và **nêu đích danh ví đó** | 036, SC-010 |
| 45 | Tạo một đơn rút tiền rồi mở lại | số tiền hiện ở **"đang chờ chi"**, đẳng thức vẫn cân | 034 |
| 46 | Duyệt đơn đó rồi mở lại | **vẫn ở "đang chờ chi"** — duyệt không phải là chi | 033a |
| 47 | Đánh dấu đã chi rồi mở lại | chuyển sang **"đã chi thật"**, hai vế cùng giảm, vẫn cân | 034 |
| 48 | Từ chối một đơn rồi mở lại | rời khỏi cả hai túi, đẳng thức quay về trước đó | 033a |

Ca 46 phân biệt spec này với một thiết kế sai: nếu duyệt làm số tiền nhảy sang "đã chi thật" thì
sổ sách nói công ty đã trả tiền trong khi chưa ai ra ngân hàng.

---

## Trước khi mở PR

- [ ] `npm run lint` xanh
- [ ] `npm test` xanh ở local, gồm cả test mới
- [ ] `npm run build` xanh
- [ ] `prisma migrate diff` báo `No difference detected` (spec này **không có migration**)
- [ ] 48 ca trên đều đạt
- [ ] **Mọi** file test đều có trong git — kiểm bằng `git status --short --untracked-files=all`
- [ ] Chạy `mv .env .env.bak && npx vitest run src/routes/withdrawal/test/ src/routes/wallet/test/ && mv .env.bak .env` — phải xanh, đó là điều kiện để CI không gãy
- [ ] `docs/deployment-runbook.md` có mục deploy spec 013, ghi rõ **BẮT BUỘC chạy seed phân quyền**
