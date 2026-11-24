# Research & Verification: Chia tiền bán hàng (phase 2)

**Ngày**: 2026-11-23 · **Spec**: [spec.md](./spec.md)

Đối chiếu từng giả định của spec với mã nguồn và dữ liệu production thật, rồi chốt các quyết định
kỹ thuật còn mở.

## Phần 1 — Đối chiếu giả định

| # | Giả định trong spec | Kết quả | Bằng chứng |
|---|---------------------|---------|------------|
| A1 | Mỗi sản phẩm thuộc đúng một nhà phát hành | **Đúng** | `Product.publisherAccountId` NOT NULL trong `schema.prisma` |
| A2 | Tài khoản nhà phát hành ứng 1-1 với người dùng | **Đúng** | `PublisherAccount.userId @unique` |
| A3 | Ví là duy nhất cho mỗi người | **Đúng** | `Profile.userId @unique` (partial, `deletedAt IS NULL`), cột `balance BIGINT` |
| A4 | Chưa có chỗ nào chặn tự mua | **Đúng** | không có tham chiếu `publisherAccountId` nào trong `src/routes/order/` |
| A5 | Nhà phát hành luôn có ví | **Đúng với dữ liệu hiện tại** | 3/3 người liên quan tới 5 đơn production đều có `Profile` |
| A6 | Tỉ lệ hoa hồng lấy được từ phase 1 | **Đúng** | production log `Validated 4 system setting(s)`, `COMMISSION_RATE_BPS = 3000` |
| A7 | Lần mua lặp lại đã có cơ chế chặn | **Đúng** | unique `(customerId, idempotencyKey)`, `order.repo.ts:179` |
| A8 | Quy mô đơn hàng còn nhỏ | **Đúng** | 5 đơn trên production |

### Dữ liệu production, kiểm 2026-11-23

| Giá | Loại | Sản phẩm |
|-----|------|----------|
| 10.000 ₫ | **tự mua** | Facebook auto comment |
| 10.000 ₫ | **tự mua** | TikTok Auto Like |
| 99.000 ₫ | bán thật | Chrome Search & Auto Click |
| 2.000 ₫ | bán thật | Facebook auto comment |
| 99.000 ₫ | bán thật | Testing version |

Không có đơn giá 0. Ví của ba người liên quan: `27fe7ffa` 28.000 ₫, `65d849b9` **0 ₫**,
`202562e1` 5.782.000 ₫. Nhà phát hành `65d849b9` đã bán 198.000 ₫ mà ví bằng 0.

Hai đơn tự mua là thứ spec ban đầu chưa lường; đã bổ sung FR-012b và FR-016b sau phát hiện này.

## Phần 2 — Quyết định kỹ thuật

### R1 — Lấy nhà phát hành ngay trong câu khoá Product

**Quyết định**: mở rộng câu `SELECT ... FOR UPDATE` trên `Product` để `JOIN "PublisherAccount"`
và trả thêm `userId`.

**Lý do**: cần nhà phát hành trước khi khoá ví, mà Product đã bị khoá ở đúng bước đó rồi. Thêm một
truy vấn riêng là thêm một vòng tới database trong lòng giao dịch mà không mua được gì —
`PublisherAccount.userId` là `@unique` và không đổi sau khi kích hoạt, nên đọc kèm là an toàn.

**Phương án đã loại**: đọc `PublisherAccount` sau khi khoá Product bằng truy vấn thứ hai — đúng về
mặt kết quả nhưng dài hơn giao dịch một cách không cần thiết.

### R2 — Mở rộng thứ tự khoá, không phá

**Quyết định**: thứ tự mới là `Product` → `ProductOffer` → **hai dòng `Profile` khoá theo `userId`
tăng dần** → `Entitlement`.

**Lý do**: `order.service.ts:113` ghi rõ thứ tự hiện tại tồn tại để các giao dịch xếp hàng thay vì
kẹt nhau. Thêm ví nhà phát hành là thêm dòng `Profile` thứ hai — đúng hình dạng gây kẹt: hai nhà
phát hành mua chéo sản phẩm của nhau sẽ lấy hai dòng theo hai chiều ngược nhau. Sắp theo `userId`
tăng dần là thứ tự mà mọi giao dịch đều đồng ý, nên không bao giờ ngược chiều.

**Hai ví luôn khác nhau** nhờ chặn tự mua (R6), nên không có trường hợp khoá trùng một dòng.

**Xác định nhà phát hành là vô điều kiện; khoá ví của họ mới có điều kiện.** Khi phần nhà phát hành
bằng 0 (hàng giá 0, hoặc tỉ lệ 100%) thì bỏ qua việc khoá và cộng ví — bỏ bớt một khoá trong cùng
thứ tự đã thống nhất thì không gây kẹt. Nhưng `publisherUserId` **vẫn phải ghi vào đơn hàng** vì
cột đó NOT NULL; nhầm chỗ này là hàng miễn phí sẽ chết ngay ở ràng buộc.

**Phương án đã loại**: cộng ví nhà phát hành bằng một câu `UPDATE` không khoá trước, đặt ở cuối
giao dịch. Ngắn hơn nhưng vẫn kẹt được: giao dịch kia có thể đang giữ dòng đó qua `SELECT FOR
UPDATE` của chính nó.

### R3 — Số nguyên, và tính phần nhà phát hành bằng phép trừ

**Quyết định**:

```text
commissionAmount = (totalAmount * rateBps) / 10000n     // BigInt, cắt phần dư
publisherAmount  = totalAmount - commissionAmount
```

**Lý do**: số thực sai thật, không phải lo xa — đã đo ở phiên trước: với 29%, phép nhân số thực cho
kết quả lệch tại 7.030 trên 2 triệu mức giá thử (giá 100 ra 28 thay vì 29). Tính phần nhà phát hành
bằng **phép trừ** chứ không nhân lần hai là thứ làm tổng luôn khớp tuyệt đối với mọi đầu vào; nhân
hai lần rồi cộng lại sẽ lệch khi không chia hết.

Phần dư thuộc nhà phát hành, đúng FR-003.

### R4 — Đọc tỉ lệ qua `SystemSettingCoreModule`

**Quyết định**: `OrderModule` import `SystemSettingCoreModule`, `OrderService` inject
`SystemSettingService` và gọi `get('COMMISSION_RATE_BPS')` bên trong giao dịch.

**Lý do**: phase 1 đã export sẵn đường đọc có kiểu cho đúng việc này (FR-019 của spec 009). Dùng
**core module** chứ không phải module có controller, theo đúng lý do ở spec 009 R2.

Không cache: một lần đánh index duy nhất, mà cache sẽ mở ra cửa sổ đơn hàng tính theo tỉ lệ quản
trị viên vừa bỏ.

### R5 — Cộng ví là câu lệnh không điều kiện, trả về số dư

**Quyết định**: trừ ví khách giữ nguyên dạng có điều kiện đang có; cộng ví nhà phát hành là
`UPDATE ... SET balance = balance + :amount ... RETURNING balance`, không điều kiện.

**Lý do**: trừ tiền có ràng buộc dưới (không được âm) nên cần điều kiện; cộng tiền thì không có
ràng buộc nào để vi phạm. Nếu câu cộng không khớp dòng nào thì nghĩa là nhà phát hành không có ví —
đó là lỗi hệ thống (FR-010), phải huỷ cả giao dịch chứ không được bán xong mà tiền bay mất.

`RETURNING balance` hiện chưa dùng tới ở phase 2, nhưng phase 3 cần nó để ghi số dư sau mỗi biến
động; lấy sẵn không tốn gì.

**Vị trí trong chuỗi ghi — bắt buộc, không phải tuỳ ý.** Thứ tự hiện tại trong giao dịch là:

```text
khoá Entitlement (order.service.ts:150)
kiểm số dư khách (:170)        ← ném InsufficientBalance ở đây
trừ ví khách      (:176)
tạo đơn hàng      (:194)
cấp quyền         (:204)
```

Câu cộng ví nhà phát hành phải chèn **giữa bước trừ ví khách và bước tạo đơn hàng**. Đặt nó trước
bước kiểm số dư thì một đơn thất bại vì khách không đủ tiền vẫn kịp cộng cho nhà phát hành rồi mới
quay lui — về mặt dữ liệu vẫn đúng nhờ rollback, nhưng là ghi thừa và làm sai ý nghĩa của thứ tự
khoá. Quickstart §4 kiểm đúng điểm này.

### R6 — Chặn tự mua ngay sau khi biết nhà phát hành

**Quyết định**: so sánh `customerId` với `publisherUserId` ngay sau R1, trước khi khoá bất kỳ ví
nào, và ném lỗi domain ổn định.

**Lý do**: chặn sớm nhất có thể để không giữ khoá vô ích. Đặt sau R1 vì trước đó chưa biết nhà phát
hành là ai.

### R7 — Màn doanh thu dùng `@SkipPermissionCheck()`, không dùng permission riêng cho PUBLISHER

**Quyết định**: hai route doanh thu gắn `@SkipPermissionCheck()` và lọc theo người đang đăng nhập,
giống `GET /publishers/me`.

**Lý do — đây là quyết định rút ra từ sự cố hôm nay, không phải sở thích**: `create-permissions.ts`
chỉ gán permission cho role **ADMIN** (`syncAdminPermissions`). Repo **không có bất kỳ seed nào**
cấp quyền cho CUSTOMER hay PUBLISHER — các grant đó trên production được tạo tay. Ngày 2026-11-23,
grant của CUSTOMER cho `POST /topups` biến mất và không script nào dựng lại được; sự cố chỉ lộ ra
khi cache Redis bị xoá, rồi phải sửa tay từng dòng.

Nếu màn doanh thu dùng permission thường, nó sẽ **403 với mọi nhà phát hành** ngay khi deploy, cho
tới khi có người vào database cấp tay — lặp lại đúng sự cố vừa xảy ra.

`create-permissions.ts` vẫn tạo bản ghi `Permission` cho hai route này (nó quét decorator, không
biết tới `SkipPermissionCheck`), nên FR-021 vẫn được thoả. Việc giới hạn "chỉ xem của mình"
(FR-019) nằm ở tầng dịch vụ: truy vấn lọc theo id người đang đăng nhập và **không nhận tham số
nhà phát hành từ client**.

**Phương án đã loại**: permission `scope = OWN` cho PUBLISHER. Đúng về mô hình, nhưng cần seed mà
repo chưa có; làm trước cái seed đó là mở rộng phạm vi phase 2 sang nợ kỹ thuật của hệ thống phân
quyền.

### R8 — Đọc doanh thu thẳng từ đơn hàng

**Quyết định**: cả danh sách lẫn bản tổng hợp truy vấn trực tiếp bảng đơn hàng theo
`(publisherUserId, createdAt DESC)`, không có bảng tổng hợp sẵn.

**Lý do**: 5 đơn trên production. Bảng tổng hợp là thứ phải giữ đồng bộ với nguồn và sẽ lệch;
Nguyên tắc VI. Khi nào tổng hợp thành điểm nóng thì làm bảng rollup, không phải bây giờ.

### R9 — Thứ tự migration cho cột NOT NULL kèm chuyển đổi dữ liệu

**Quyết định**: ba bước trong **cùng một file migration**: thêm cột cho phép NULL → điền dữ liệu
cũ → đặt NOT NULL và thêm các ràng buộc.

**Lý do**: không thể thêm cột NOT NULL vào bảng đã có dòng mà không có mặc định, và mặc định sai sẽ
đóng băng một con số bịa vào lịch sử. Ba bước trong một file giữ cho mọi môi trường đi qua đúng một
đường.

Ràng buộc tổng-phải-khớp chỉ được thêm **sau** khi điền xong, nếu không bước điền sẽ tự vi phạm nó.

### R10 — Chuyển đổi dữ liệu cũ: một luật duy nhất cho cả 5 đơn

**ĐÃ CHỐT 2026-11-23.** Chủ repo xác nhận cả 5 đơn trên production là **giao dịch thử của chính
mình**, không phải khách thật. Không có ai cần được trả lại tiền.

**Quyết định**: mọi đơn hàng đã tồn tại được ghi `commissionRateBps = 10000`,
`commissionAmount = totalAmount`, `publisherAmount = 0`, và **không cộng ví ai**.

**Lý do**: ghi đúng sự thật — chưa đồng nào từng chạy vào ví nhà phát hành cho những đơn đó. Ghi một
tỉ lệ khác sẽ đóng băng vào lịch sử một con số chưa bao giờ xảy ra.

Không còn phải chia hai nhóm: đơn tự mua và đơn còn lại nhận cùng một cách xử lý, nên bước chuyển
đổi là **một câu lệnh duy nhất**, không có nhánh điều kiện và không đụng tới `Profile.balance`.

**Phương án đã loại**: chia lại theo tỉ lệ hiện hành rồi cộng thật vào ví (chênh 140.000 ₫ cho một
nhà phát hành). Bị loại vì tiền đó chưa bao giờ là doanh thu thật; cộng vào sẽ tạo ra số dư từ hư
không và làm sai mọi đối soát về sau.

FR-016b (đơn tự mua không được chia tiền) **vẫn giữ nguyên** dù hiện tại nó trùng với luật chung.
Nó là cái chặn nếu sau này có môi trường khác mà luật chung được đổi.

## Phần 3 — Đã kiểm và không thành vấn đề

- **Không có đơn giá 0 trên production**, nhưng đường code vẫn phải xử lý vì sản phẩm miễn phí là
  hợp lệ (FR-011).
- **`OrderModule` hiện chỉ import `EntitlementModule`**, thêm `SystemSettingCoreModule` không tạo
  vòng phụ thuộc: system-setting không biết gì về order.
- **Không có tiến trình nào khác tạo đơn hàng** ngoài `OrderService`; cron và consumer không đụng
  tới bảng đơn hàng.
- **Lần mua lặp lại** đã được chặn bởi unique `(customerId, idempotencyKey)` cộng với việc khoá ví
  khách làm điểm nối tiếp; cộng ví nhà phát hành nằm trong cùng giao dịch nên thừa hưởng nguyên vẹn
  tính chất đó (FR-009).
