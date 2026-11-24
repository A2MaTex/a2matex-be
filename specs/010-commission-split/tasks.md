---

description: "Task list cho chia tiền bán hàng — phase 2 của module payout"
---

# Tasks: Chia tiền bán hàng giữa sàn và nhà phát hành

**Input**: design documents trong `specs/010-commission-split/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/commission-split-api.md](./contracts/commission-split-api.md),
[quickstart.md](./quickstart.md)

**Tests**: CÓ. Plan nêu 4 file test và Nguyên tắc IV bắt `npm test` pass. Đã kiểm:
`src/routes/order/` **chưa có test nào**, nên không có test cũ bị vỡ.

**Branch**: `feat/commission-split`, tách từ `staging` tại `51a5ae4`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác file, không phụ thuộc task chưa xong)
- **[Story]**: US1 / US2 / US3 theo spec.md

---

## Phase 1: Setup — bốn cột trên đơn hàng

**Mục đích**: dựng chỗ chứa phần chia tiền. Mọi thứ còn lại đọc từ đây.

- [X] T001 Tạo thư mục migration `prisma/migrations/<timestamp>_add_order_revenue_split/` và viết **bước 1** vào `migration.sql`: `ALTER TABLE "Order"` thêm `"publisherUserId" UUID REFERENCES "User" (id) ON DELETE NO ACTION`, `"commissionRateBps" INTEGER`, `"commissionAmount" BIGINT`, `"publisherAmount" BIGINT` — **tất cả cho phép NULL ở bước này**, vì bảng đã có 5 dòng và cột NOT NULL không mặc định sẽ fail
- [X] T002 Viết **bước 2** vào cùng file: một câu `UPDATE` duy nhất điền cho mọi đơn đã tồn tại — `publisherUserId` lấy từ `Product → PublisherAccount.userId`, `commissionRateBps = 10000`, `commissionAmount = totalAmount`, `publisherAmount = 0`, điều kiện `WHERE "publisherUserId" IS NULL`. Sao đúng câu lệnh ở [data-model.md](./data-model.md) mục 4. **Tuyệt đối không có câu `UPDATE "Profile"` nào** — chủ repo xác nhận 5 đơn đó là giao dịch thử, không ai được cộng tiền
- [X] T003 Viết **bước 3** vào cùng file: `SET NOT NULL` cho cả 4 cột; thêm `CONSTRAINT "Order_commissionRateBps_check" CHECK ("commissionRateBps" >= 0 AND "commissionRateBps" <= 10000)`; thêm `CONSTRAINT "Order_split_exact_check" CHECK ("commissionAmount" >= 0 AND "publisherAmount" >= 0 AND "commissionAmount" + "publisherAmount" = "totalAmount")`; tạo `CREATE INDEX "Order_publisherUserId_createdAt_idx" ON "Order" ("publisherUserId", "createdAt" DESC)`. Ràng buộc phải đứng **sau** bước 2, nếu không chính bước điền sẽ vi phạm nó
- [X] T004 Ghi lại số dư mọi ví trước khi chạy, rồi `npm run prisma:migrate:deploy` trên database local, rồi đối chiếu theo quickstart §1: không đơn nào còn `publisherUserId IS NULL`, mọi đơn có tổng hai phần khớp `totalAmount`, và **số dư mọi ví giống hệt trước và sau**
- [X] T005 Sửa `prisma/schema.prisma` **bằng tay** theo [data-model.md](./data-model.md) mục 5 (4 trường + quan hệ `publisher` + `@@index`), thêm quan hệ ngược `publisherOrders` trên `User`, rồi chạy `npm run prisma:generate`. **Không introspect** — database local có drift `Static.publisherAccountId` sẵn và introspect sẽ kéo nó vào. Quên `prisma:generate` thì `npm run build` fail TS2694
- [X] T006 [P] Thêm 4 trường vào `src/entities/order.model.ts`: `publisherUserId` (uuid), `commissionRateBps` (int), `commissionAmount` và `publisherAmount` (BigInt dạng chuỗi theo quy ước có sẵn của `totalAmount`)

**Checkpoint**: 4 cột tồn tại, đơn cũ đã điền, không ví nào bị đụng.

---

## Phase 2: Foundational — phép tính chia tiền

**Mục đích**: hàm thuần tính chia tiền, dùng chung cho đường mua và cho mọi kiểm thử.

**⚠️ Chặn US1. US2 không cần phase này** (chỉ đọc 4 cột ở Phase 1).

- [X] T007 Viết hàm thuần `splitAmount(totalAmount: bigint, rateBps: number)` trong `src/routes/order/order.model.ts` (hoặc một file util cạnh nó), trả `{ commissionAmount, publisherAmount }`. Công thức bắt buộc: `commissionAmount = (totalAmount * BigInt(rateBps)) / 10000n` (BigInt, cắt phần dư) và `publisherAmount = totalAmount - commissionAmount`. **Phải tính phần nhà phát hành bằng phép trừ**, không nhân lần hai — đây là thứ làm tổng luôn khớp tuyệt đối. Không dùng `number` ở bất kỳ bước nào của phép tính
- [X] T008 [P] Viết `src/routes/order/test/commission-split.spec.ts` với **test bất biến quét nhiều giá trị**: lặp qua hàng loạt cặp `(totalAmount, rateBps)` — gồm các mức giá không chia hết và các tỉ lệ 0, 1, 2900, 3000, 9999, 10000 — và assert `commissionAmount + publisherAmount === totalAmount` **chính xác** ở mọi cặp. Đây mới là test bảo vệ FR-002: một bộ test chỉ so sánh với vài giá trị mẫu sẽ pass với cả bản cài đặt dùng số thực, còn bất biến thì gãy ngay
- [X] T009 [P] Bổ sung vào cùng file các ca biên theo bảng ở [data-model.md](./data-model.md) mục 6: `100/2900 → 29` (số thực cho 28), `100005/3000 → 30001/70004`, `1/3000 → 0/1`, `0/3000 → 0/0`, `99000/0 → 0/99000`, `99000/10000 → 99000/0`. Và assert phần dư luôn thuộc nhà phát hành

**Checkpoint**: `npm test` xanh, chưa đụng gì tới đường mua hàng.

---

## Phase 3: User Story 1 — Nhà phát hành nhận tiền khi bán được hàng (P1) 🎯 MVP

**Goal**: khách mua thì ví khách giảm đúng giá bán và ví nhà phát hành tăng đúng phần của họ, trong
cùng một giao dịch.

**Independent Test**: mua một đơn, so số dư hai bên trước/sau; tổng thay đổi cộng phần sàn giữ phải
bằng đúng giá bán (quickstart §3).

### Tầng dữ liệu

- [X] T010 [US1] Mở rộng `lockProduct` trong `src/routes/order/order.repo.ts`: câu `SELECT ... FOR UPDATE` trên `"Product"` thêm `JOIN "PublisherAccount"` để trả kèm `userId` của nhà phát hành. Không thêm truy vấn riêng — Product đã bị khoá ở đúng bước này rồi (research R1)
- [X] T011 [US1] Thay `lockCustomerProfile` bằng hàm khoá **hai dòng** `Profile` trong một câu, `WHERE "userId" IN (:a, :b) ORDER BY "userId" FOR UPDATE`. Sắp theo `userId` tăng dần là thứ chặn kẹt khi hai nhà phát hành mua chéo nhau (research R2). Trả về số dư của khách để bước kiểm số dư dùng
- [X] T012 [US1] Thêm `creditPublisherBalance` vào `order.repo.ts`: `UPDATE "Profile" SET balance = balance + :amount WHERE "userId" = :publisherUserId AND "deletedAt" IS NULL RETURNING balance`. **Không điều kiện** — cộng tiền không có ràng buộc dưới nào để vi phạm. Khớp 0 dòng nghĩa là nhà phát hành không có ví: lỗi hệ thống, phải huỷ cả giao dịch
- [X] T013 [US1] Mở rộng `createOrder` trong `order.repo.ts` ghi thêm 4 cột `publisherUserId`, `commissionRateBps`, `commissionAmount`, `publisherAmount`

### Tầng nghiệp vụ

- [X] T014 [US1] Thêm 3 lỗi vào `src/routes/order/order.error.ts` theo quy ước hằng số có sẵn: `CannotPurchaseOwnProductException` = `ConflictException('Error.CannotPurchaseOwnProduct')`, `CommissionRateUnavailableException` = `ServiceUnavailableException('Error.CommissionRateUnavailable')`, `PublisherProfileNotFoundException` cho trường hợp nhà phát hành không có ví
- [X] T015 [US1] Sửa `src/routes/order/order.module.ts` import `SystemSettingCoreModule` — **core**, không phải `SystemSettingModule` có controller (lý do ở spec 009 R2)
- [X] T016 [US1] Trong `src/routes/order/order.service.ts`, inject `SystemSettingService` và đọc `COMMISSION_RATE_BPS` **bên trong** giao dịch, không cache. Đọc hỏng thì ném `CommissionRateUnavailableException` — **cấm** rơi về một tỉ lệ mặc định (FR-004)
- [X] T017 [US1] Thêm chặn tự mua vào `order.service.ts`: so `customerId` với `publisherUserId` **ngay sau khi khoá Product** (T010) và **trước khi khoá ví nào**, ném `CannotPurchaseOwnProductException`. Chặn sớm để không giữ khoá cho một giao dịch chắc chắn bị từ chối
- [X] T018 [US1] Ghép chuỗi ghi trong `order.service.ts` theo đúng thứ tự ở [plan.md](./plan.md): khoá Product (kèm publisher) → khoá Offer → chặn tự mua → khoá 2 ví theo `userId` tăng dần → khoá Entitlement → kiểm số dư khách → **trừ ví khách** → **cộng ví publisher** → tạo đơn (ghi 4 cột) → cấp quyền. Cộng ví nhà phát hành phải nằm **sau** bước kiểm số dư và trừ ví khách, nếu không một đơn thất bại vì khách thiếu tiền vẫn kịp ghi vào ví nhà phát hành
- [X] T019 [US1] Xử lý hàng giá 0 và tỉ lệ 100% trong `order.service.ts`: khi `publisherAmount` bằng 0 thì **bỏ qua khoá và cộng ví** nhà phát hành (bỏ bớt một khoá trong cùng thứ tự đã thống nhất thì không gây kẹt), nhưng **vẫn phải ghi `publisherUserId` vào đơn** vì cột đó NOT NULL — nhầm chỗ này là hàng miễn phí chết ngay ở ràng buộc
- [X] T020 [US1] Thêm 4 trường split vào output của đơn hàng trong `src/routes/order/order.model.ts` theo [contracts](./contracts/commission-split-api.md) mục 1: trả `commissionRateBps`, `commissionAmount`, `publisherAmount`; **không trả `publisherUserId`** cho khách

### Kiểm thử

- [X] T021 [P] [US1] Viết `src/routes/order/test/order-split.service.spec.ts`: chặn tự mua ném đúng lỗi và không gọi hàm cộng/trừ ví nào; thiếu cấu hình hoa hồng ném `CommissionRateUnavailable` và không đụng ví; giá 0 không gọi cộng ví nhưng vẫn truyền `publisherUserId` vào `createOrder`; cộng ví khớp 0 dòng thì ném lỗi
- [X] T022 [US1] Verify quickstart §3, §4, §5, §9, §10, §11 trên bản build (`npm run build && npm run start:prod`) — **không dùng `start:dev`**, vì `tsx` không emit decorator metadata nên DTO không được xác thực

**Checkpoint**: tiền chạy đúng hai chiều. Đây là MVP của phase 2.

---

## Phase 4: User Story 2 — Nhà phát hành theo dõi doanh thu (P2)

**Goal**: xem từng đơn đã bán kèm giá khách trả, phần sàn giữ, phần thực nhận, và một bản tổng hợp.

**Independent Test**: bán vài đơn rồi mở trang doanh thu, đối chiếu từng dòng và tổng với thay đổi
thực tế của số dư (quickstart §13).

**Độc lập với Phase 2 và 3**: chỉ cần 4 cột ở Phase 1. Có thể làm song song với US1 nếu có hai người.

- [X] T023 [P] [US2] Tạo `src/routes/publisher-earning/publisher-earning.model.ts`: schema input phân trang theo quy ước có sẵn, schema output một dòng doanh thu (`orderId`, `productId`, `productName`, `totalAmount`, `commissionAmount`, `publisherAmount`, `commissionRateBps`, `paidAt`) và schema tổng hợp (`orderCount`, `grossAmount`, `commissionAmount`, `netAmount`). Số tiền serialize thành **chuỗi thập phân** như `totalAmount` đang làm
- [X] T024 [US2] Tạo `src/routes/publisher-earning/publisher-earning.dto.ts` bọc các schema trên bằng `createZodDto`
- [X] T025 [US2] Tạo `src/routes/publisher-earning/publisher-earning.repo.ts`: truy vấn danh sách lọc theo `publisherUserId` đi theo index `("publisherUserId", "createdAt" DESC)`, và truy vấn tổng hợp. Cả hai **chỉ nhận `publisherUserId` từ tầng trên**, không có tham số nào khác ảnh hưởng tới việc lọc
- [X] T026 [US2] Tạo `src/routes/publisher-earning/publisher-earning.service.ts`: lấy `publisherUserId` từ người đang đăng nhập, không bao giờ từ client. Người chưa bán gì nhận danh sách rỗng và tổng bằng 0, **không phải lỗi**
- [X] T027 [US2] Tạo `src/routes/publisher-earning/publisher-earning.controller.ts` với `@Controller('publisher-earnings')`, hai route `GET /` và `GET /summary`, mỗi route gắn **`@SkipPermissionCheck()`** và nhận `@ActiveUser('userId')`. Dùng `@SkipPermissionCheck()` chứ không phải permission thường vì repo chưa có cách seed quyền cho role không phải ADMIN — route như vậy sẽ 403 với mọi nhà phát hành ngay sau deploy (research R7)
- [X] T028 [US2] Tạo `publisher-earning.module.ts` và import vào `src/app.module.ts`
- [X] T029 [P] [US2] Viết `src/routes/publisher-earning/test/publisher-earning.service.spec.ts`: truy vấn luôn lọc theo người đang đăng nhập; tham số lạ từ client không đổi được bộ lọc; người chưa bán gì trả rỗng chứ không ném lỗi; `grossAmount = commissionAmount + netAmount` trong bản tổng hợp
- [X] T030 [US2] Chạy `npm run seed:permissions`, kiểm theo quickstart §14 rằng bảng `Permission` có 2 dòng `publisher-earnings` và script đã in dòng xoá cache. Nếu phải xoá cache tay thì dùng pattern `*role_permissions:*` — Redis có namespace prefix nên `role_permissions:*` khớp 0 key và trông như đã sạch

**Checkpoint**: US1 và US2 đều chạy độc lập.

---

## Phase 5: User Story 3 — Lịch sử chia tiền không đổi được (P3)

**Goal**: đổi tỉ lệ hoặc đổi chủ sở hữu sản phẩm không làm thay đổi con số của đơn đã bán.

**Lưu ý về bản chất phase này**: tính bất biến đến từ **thiết kế dữ liệu** ở Phase 1 (đóng băng 4
giá trị lên từng đơn) chứ không từ một đoạn mã riêng. Nên phase này là **kiểm chứng**, không có
task cài đặt. Ghi ra thành phase riêng vì nếu không kiểm thì không ai biết nó có đúng hay không.

- [X] T031 [US3] Verify quickstart §12: ghi lại 4 giá trị split của một đơn, đổi tỉ lệ sang 2500 qua API quản trị, đọc lại đơn cũ và xác nhận **không con số nào đổi**; đơn mua kế tiếp áp 2500
- [X] T032 [US3] Verify đổi chủ sở hữu: đổi `Product.publisherAccountId` sang một nhà phát hành khác bằng SQL, rồi đọc lại đơn cũ và xác nhận nó **vẫn truy ra người đã thực nhận tiền** chứ không phải chủ mới. Nhớ trả lại trạng thái cũ sau khi thử
- [X] T033 [US3] Verify quickstart §15: tính doanh thu hoa hồng của sàn bằng `SUM("commissionAmount")` và xác nhận ra được con số mà không cần nguồn dữ liệu nào khác

**Checkpoint**: cả 3 user story kiểm được độc lập.

---

## Phase 6: Polish & hoàn tất

- [X] T034 Verify quickstart §6 — hai nhà phát hành mua chéo sản phẩm của nhau **đồng thời**: cả hai trả 201, và `docker logs a2matex-postgres` không có `deadlock detected`. Đây là lý do tồn tại của việc sắp thứ tự khoá, không kiểm thì coi như chưa làm
- [X] T035 Verify quickstart §7 và §8 — hai khách mua đồng thời từ một nhà phát hành thì số dư tăng đủ cả hai lần; mua lặp cùng `Idempotency-Key` chỉ cộng một lần
- [X] T036 Chạy `npm run lint`, `npm test`, `npm run build` — cả ba phải pass (Nguyên tắc IV)
- [X] T037 Chạy `docker build -t a2matex-verify .` và xác nhận image build được. **Bắt buộc**: nó cài lại dependency từ đầu, và ngày 2026-11-23 build này từng gãy vì xung đột `cron` trong khi `npm run build` ở local vẫn xanh
- [X] T038 Chạy trọn 16 kịch bản trong [quickstart.md](./quickstart.md) trên database local, đối chiếu bảng nghiệm thu ở cuối file
- [X] T039 Cập nhật `docs/deployment-runbook.md`: sau khi deploy phase này phải chạy `seed-permissions` cho 2 route mới, và nhắc rằng migration **không** đụng tới ví nên không cần thao tác tiền nào trên production

**Checkpoint**: sẵn sàng mở PR.

---

## Dependencies & Execution Order

### Phụ thuộc giữa các phase

- **Phase 1 (Setup)**: không phụ thuộc gì
- **Phase 2 (Foundational)**: cần Phase 1 — **chặn US1**, không chặn US2
- **Phase 3 (US1)**: cần Phase 1 + Phase 2
- **Phase 4 (US2)**: chỉ cần Phase 1
- **Phase 5 (US3)**: cần Phase 3 để có đơn mới mà kiểm; T033 chỉ cần Phase 1
- **Phase 6 (Polish)**: cần các story muốn ship đã xong

### Phụ thuộc giữa các user story

- **US1 (P1)**: độc lập sau Phase 2
- **US2 (P2)**: độc lập sau Phase 1 — **không** phụ thuộc US1. Hai người làm song song được
- **US3 (P3)**: kiểm chứng, cần US1 đã chạy để có đơn mới. Không có task cài đặt nên không chặn ai

### Chỗ chạy song song được

- T006 song song với T005 xong
- T008, T009 song song sau T007
- T021 song song với T020
- T023 và T029 song song trong US2
- **US1 và US2 chạy song song hoàn toàn** sau Phase 1: US1 đụng `src/routes/order/`, US2 đụng `src/routes/publisher-earning/`, không chung file nào. Chỉ `src/app.module.ts` bị cả hai sửa (T015 và T028) nên hai task đó phải nối tiếp

---

## Parallel Example: Phase 2

```bash
# Sau khi T007 (hàm chia tiền) xong:
Task: "T008 Test bất biến quét nhiều giá trị"
Task: "T009 Test các ca biên theo bảng data-model"
```

---

## Implementation Strategy

### MVP trước (chỉ US1)

1. Phase 1: Setup — 4 cột, đơn cũ đã điền
2. Phase 2: Foundational — hàm chia tiền + test bất biến *(chặn US1)*
3. Phase 3: US1 — tiền chạy đúng hai chiều
4. **DỪNG VÀ KIỂM** — quickstart §3, §4, §5, §6, §9, §10, §11
5. Phase 6 để hoàn tất

Tới đây nhà phát hành đã thực sự nhận được tiền khi bán hàng — thứ mà hôm nay chưa có.

### Giao từng phần

1. Setup + Foundational → nền sẵn sàng
2. US1 → kiểm độc lập → deploy (MVP)
3. US2 → kiểm độc lập → nhà phát hành nhìn được doanh thu
4. US3 → kiểm chứng tính bất biến

### Không làm gì ở phase này

Không có sổ ghi biến động số dư, không rút tiền, không hoàn tiền, không ví riêng cho sàn. Phần hoa
hồng sàn giữ chỉ được ghi trên từng đơn, không cộng vào tài khoản nào.

---

## Notes

- `[P]` = khác file, không phụ thuộc nhau
- Mọi kiểm thử validation chạy trên bản build (`npm run build && npm run start:prod`); `start:dev`
  không xác thực DTO vì `tsx` không emit decorator metadata
- Mọi migrate/seed/test chạy trên database local (`npm run compose-up`), không đụng Cloud SQL
- Database local có drift sẵn `Static.publisherAccountId`: dùng migration viết tay + `migrate
  deploy`, sửa `schema.prisma` bằng tay, **không introspect**
- Commit sau mỗi task hoặc mỗi nhóm hợp lý; dừng ở bất kỳ checkpoint nào để kiểm độc lập
