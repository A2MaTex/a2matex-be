# Research & Verification: Sổ cái ví và tài khoản tiền của sàn (phase 3)

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Ngày 2026-11-24, cập nhật lớn 2026-11-25. Mọi khẳng định dưới đây đã đối chiếu với mã nguồn hoặc
dữ liệu production, có dẫn đường dẫn và số dòng.

## Phần 1 — Đối chiếu giả định với mã nguồn

| Giả định ban đầu | Thực tế | Bằng chứng |
|---|---|---|
| Có ba chỗ làm số dư đổi | **Đúng** | `topup.service.ts` `creditTopUp`; `order.repo.ts:139` `debitBalance`; `order.repo.ts:155` `creditPublisherBalance` |
| Phần hoa hồng được ghi vào đâu đó | **Sai** | `order.service.ts:246-271` chỉ trừ khách và cộng publisher. Phần chênh `commissionAmount` **không vào tài khoản nào** — nó chỉ là một cột trên `Order` |
| Trừ ví khách có chặn âm sẵn | **Đúng** | `order.repo.ts:146` dùng `balance: { gte: amount }` ngay trong câu lệnh |
| Hai phần chia luôn cộng lại bằng tổng | **Đúng** | `order-split.ts:16` tính phần publisher bằng **phép trừ**, không nhân lần hai; comment trong file nêu rõ lý do |
| Repo đã dùng `updateManyAndReturn` ở đâu đó | **Đúng** | `project-draft.repo.ts:108` |
| Có sẵn cách bỏ qua kiểm permission | **Đúng** | `auth.decorator.ts:26` `SkipPermissionCheck`, guard đọc ở `access-token.guard.ts:72` |
| Có tiền lệ tách module Core/Module | **Đúng** | `src/routes/system-setting/` có cả `system-setting-core.module.ts` và `system-setting.module.ts` |
| `Order` sửa/xoá được | **Sai** | docstring trên `model Order` ghi rõ: *"Immutable once written: there is no update path, no soft delete"* |
| `User.email` và `username` có ràng buộc duy nhất | **Đúng** | `init/migration.sql:42-43`, unique index trên `lower()` với điều kiện `deletedAt IS NULL` |
| Đăng nhập chặn mọi trạng thái không hoạt động | **Sai** | `auth.service.ts:518` `assertUserCanSignIn` **chỉ** chặn `BANNED`; `INACTIVE` vẫn vào được |

### Dữ liệu production, kiểm ngày 2026-11-24

- 10 ví, 6 lần nạp tiền đã ghi có, 7 đơn hàng.
- 8/10 ví dựng lại chính xác từ dữ liệu nạp tiền và đơn hàng.
- 2 ví lệch **5.994.000 ₫** và **10.000.000 ₫**; hai ví đó đã tiêu **218.000 ₫** và **109.000 ₫**
  vào đơn hàng có thật.
- 0 ví cho ra số dư-sau âm tại bất kỳ điểm nào khi phát lại lịch sử.
- 0 ví rơi vào trường hợp lịch sử cộng ra **nhiều hơn** số dư thật.
- Cả 7 đơn đều do phase 2 ghi về phía sàn, nên `publisherAmount = 0` và
  `commissionAmount = totalAmount` trên toàn bộ.

## Phần 2 — Quyết định kỹ thuật

### R1 — `updateManyAndReturn` cho mọi chỗ ghi số dư

**Quyết định**: bốn đường đổi số dư (`creditTopUp`, `debitBalance`, `creditPublisherBalance`, và
đường mới cho tài khoản của sàn) đổi từ `updateMany` sang `updateManyAndReturn`.

**Lý do**: FR-005 đòi số dư ghi trong sổ phải lấy từ chính thao tác đã đổi nó. Đọc lại bằng một
câu `SELECT` riêng là mở ra một cửa sổ tranh chấp — hai giao dịch song song đọc ra cùng một số dư.
`updateManyAndReturn` trả về hàng sau khi cập nhật, trong cùng một câu lệnh.

**Đã bác bỏ**: tự cộng trừ ở tầng ứng dụng rồi ghi; đọc lại sau khi ghi.

**Kiểm**: Prisma 7 có sẵn, repo đã dùng ở `project-draft.repo.ts:108`.

### R2 — Ghi sổ và đổi số dư trong cùng transaction

**Quyết định**: mọi luồng bọc trong một transaction; thất bại ở bất kỳ bước nào thì không bước nào
có hiệu lực.

**Lý do**: FR-006. Số dư đổi mà sổ không ghi là hỏng đúng thứ mà sổ sinh ra để chữa.

**Áp dụng cho cả hai chân của một lần chuyển khoản** — nửa chuyển khoản còn tệ hơn không có gì.

### R3 — Ghi sổ **sau** khi tạo đơn, không phải ngay sau lệnh tiền

**Quyết định**: trong luồng mua, đổi số dư trước, tạo đơn, rồi mới ghi ba bút toán.

**Lý do**: ba bút toán của một đơn đều phải trỏ về đơn đó (FR-003), mà mã đơn chỉ có sau khi
`createOrder` chạy xong.

**Đánh đổi đã chấp nhận**: giữa hai mốc đó có một khoảnh khắc số dư đã đổi mà sổ chưa ghi. Vì cả
ba nằm trong một transaction nên không ai quan sát được trạng thái đó.

### R4 — Tiền của sàn: bảng riêng, không phải tài khoản người dùng giả

**Quyết định**: `SystemAccount` là một bảng riêng, khoá chính là loại tài khoản. `WalletTransaction`
nhận thêm cột `systemAccount`, và `userId` chuyển thành nullable, kèm ràng buộc đúng một trong hai
không rỗng.

**Đã bác bỏ — tạo một `User` + `Profile` dành riêng cho sàn**: nghe thì tái dụng được nhiều hơn
(khoá ngoại giữ nguyên `NOT NULL`, dùng lại `Profile.balance`), nhưng có hai khuyết điểm cứng:

1. **Lỗ xoá mềm.** Phép đối soát ví người dùng lọc `WHERE pr."deletedAt" IS NULL`. Chỉ cần ai đó
   xoá mềm tài khoản của sàn là nó rơi khỏi phép đối soát, mà phép đối soát **vẫn trả về 0 dòng**.
   Một phép kiểm lặng lẽ ngừng kiểm còn nguy hơn không có phép kiểm nào.
2. **Món nợ kỷ luật vĩnh viễn.** Mọi truy vấn đếm hoặc liệt kê người dùng về sau đều phải nhớ loại
   trừ nó — `user.repo.ts:245-246` tìm kiếm theo `username`/`email` là chỗ đầu tiên lộ ra.

**Phản biện đã cân nhắc và bác bỏ**: "cho `userId` nullable là nới lỏng khoá ngoại". Không phải —
với `CHECK` buộc đúng một trong hai cột không rỗng, khoá ngoại vẫn kích hoạt với mọi giá trị không
rỗng, và `CHECK` làm bất biến trở nên toàn phần.

### R5 — `ADMIN_GRANT` là chuyển khoản hai chân, không phải một khoản cộng

**Quyết định**: quản trị viên cộng tiền ghi **hai** bản ghi — một `DEBIT` ở tài khoản của sàn, một
`CREDIT` ở ví người nhận — nối nhau bằng cột `transferId`.

**Lý do**: nếu quản trị viên cộng thẳng cho người dùng mà không rút từ đâu, thì mỗi lần cộng là một
lần tiền không có thật xuất hiện ở một ví khác nhau, không con số nào gom lại được. Đó chính là
15.994.000 ₫ trên production hôm nay. Rút từ tài khoản của sàn biến nó thành chuyển khoản nội bộ —
tổng nghĩa vụ không đổi, và ràng buộc không-âm trên tài khoản của sàn trở thành **chốt chặn thật**:
quản trị viên chỉ cho đi được phần sàn đang có.

**Tên gọi**: ban đầu đặt là `ADMIN_CREDIT`, đổi thành `ADMIN_GRANT` ngày 2026-11-25. Lý do:
`ADMIN_CREDIT` đi với `direction = DEBIT` ở chân phía sàn đọc lên tự mâu thuẫn. Repo đã có tiền lệ
`EntitlementGrantSource.ADMIN_GRANT`.

**Đã bác bỏ**: một bản ghi duy nhất mang số âm; hai bản ghi không nối nhau (không chứng minh được
mọi khoản trừ đều có khoản cộng đối ứng).

### R6 — `ISSUED_CREDIT`: một loại, không tách `CAPITAL_INJECTION`

**Quyết định**: một loại duy nhất cho việc bơm tiền vào tài khoản của sàn.

**Lý do**: ở quy mô 10 ví, tách hai loại là trừu tượng hoá sớm (Nguyên tắc VI). Kèm **cam kết vận
hành** ghi trong Assumptions của spec: loại đó không bao giờ dùng cho tiền công ty chuyển thật vào
ngân hàng.

**Rủi ro đã ghi nhận**: cam kết không có gì trong hệ thống ép. Ngày nào nghiệp vụ nạp vốn thật phát
sinh, phải tách loại **trước khi** dùng — thêm giá trị vào enum không đụng bản ghi đã có, nhưng
phân loại lại dữ liệu cũ thì phải đoán.

### R7 — Bỏ `OPENING_BALANCE`, thay bằng dọn dữ liệu chạy trước

**Quyết định**: không có loại bút toán "số dư mở đầu". Phần số dư thử nghiệm được dọn sạch trong
một bước riêng chạy **trước** migration.

**Lý do đảo quyết định ngày 2026-11-24**: khi đã có tài khoản của sàn, khoản không truy nguyên được
không còn cần một cơ chế riêng để hấp thụ. Và quan trọng hơn: `OPENING_BALANCE` để lại vĩnh viễn
15.994.000 ₫ nợ ảo trong sổ sách, trong khi dọn thì xoá hẳn.

**Dọn nghĩa là gì** — đây là chỗ dễ làm sai nhất: **không thể chỉ đưa số dư về 0**. Hai ví đó đã
tiêu 218.000 ₫ và 109.000 ₫ vào đơn hàng có thật. Đưa số dư về 0 mà để nguyên đơn thì backfill dựng
ra `balanceAfter = −218.000`, và ràng buộc không-âm từ chối. Dọn = xoá `Entitlement` → xoá `Order`
→ đưa `balance` về 0, theo đúng thứ tự đó (cả hai khoá ngoại đều `onDelete: NoAction`).

**Hệ quả đã chấp nhận**: `Order` được thiết kế immutable không có đường xoá, nên đây là ngoại lệ cố
ý, chạy một lần, phải ghi vào runbook. Doanh thu đã ghi nhận của kỳ đã qua giảm đúng phần hoa hồng
của các đơn bị xoá — ở quy mô hiện tại không đáng kể. Chủ repo xác nhận ngày 2026-11-25, dù hai tài
khoản test vẫn đang dùng.

**Đã bác bỏ**: bịa một lần nạp tiền giả (làm hỏng báo cáo tiền mặt — một khoản không có thật trở
thành khoản thu không bao giờ đối chiếu được với sao kê ngân hàng); ghi lại thành `ISSUED_CREDIT`
dựng lại (phải điền người thực hiện mà không ai biết là ai, hoặc phải nới ràng buộc kiểm toán cho
mọi dòng tương lai).

### R8 — Backfill nằm trong migration, có chốt chặn chạy trùng và chốt dừng

**Quyết định**: việc dựng lại lịch sử nằm trong **cùng file migration** với việc tạo bảng. Mỗi câu
chèn có `ON CONFLICT DO NOTHING` dựa trên index duy nhất.

**Lý do**: tách ra thành script chạy tay là mở một cửa sổ bảng-đã-có-mà-lịch-sử-chưa. Deploy của
repo này từng gãy giữa chừng (xem `deploy-kafka-healthcheck-flake`), nên khả năng chạy lại không
phải phòng xa.

**Mới so với bản cũ — hai chốt dừng.** Vì không còn cơ chế bù trừ, backfill phải `RAISE EXCEPTION`
nếu: (a) có ví nào lịch sử cộng ra nhiều hơn số dư thật, (b) có tài khoản nào còn lệch sau khi
dựng. Dừng tại migration đắt hơn nhiều so với phát hiện sau khi bảng đã có dữ liệu production.

### R9 — Số dư sau cho dữ liệu cũ: tổng luỹ kế, phá thế hoà cố định

**Quyết định**: điền `balanceAfter` bằng window function cộng dồn theo tài khoản, thứ tự
`createdAt` → độ ưu tiên loại → `id`.

**Lý do**: thiếu quy tắc phá thế hoà thì hai lần chạy có thể cho hai chuỗi số dư khác nhau mà tổng
vẫn đúng — vi phạm SC-007.

**Chi tiết mới**: phân hoạch theo `COALESCE(userId::text, systemAccount::text)` vì nay có hai loại
tài khoản trong cùng một bảng.

### R10 — Đối soát là truy vấn trong runbook, không phải route

**Quyết định**: năm phép đối soát viết thành SQL trong `docs/deployment-runbook.md`, không dựng API.

**Lý do**: Nguyên tắc VI. Người vận hành đã có đường vào database; một route chỉ để chạy câu lệnh
sẵn có là thêm bề mặt tấn công đổi lấy không gì cả.

### R11 — Ràng buộc số dư không-âm cho cả ba chỗ

**Quyết định**: `CHECK (balance >= 0)` trên `Profile`, trên `SystemAccount`, và
`CHECK ("balanceAfter" >= 0)` trên `WalletTransaction`.

**Lý do đảo quyết định ban đầu**: hoàn tiền là đường duy nhất có thể đẩy số dư xuống âm, và nó đã
bị bỏ khỏi phase này. Đã kiểm trên production: 10 ví, 0 ví âm tại bất kỳ điểm nào.

**Cảnh báo cho phase sau**: spec bảo hành ở mục Out of Scope **giữ được** ràng buộc này — vì tiền
chưa bao giờ tới tay nhà phát hành nên không có gì phải đòi lại. Nhưng nếu có ai thiết kế hoàn tiền
theo kiểu thu hồi phần đã chia, phải gỡ ràng buộc trước.

### R12 — Guard của `ADMIN_GRANT` kiểm ở câu lệnh, không phải ở `CHECK`

**Quyết định**: chân trừ ở tài khoản của sàn dùng conditional update
(`WHERE balance >= :amount`) rồi kiểm số dòng bị ảnh hưởng; 0 dòng → ném lỗi nghiệp vụ.

**Lý do**: để `CHECK` bắt thì nó ném lỗi ràng buộc, thành HTTP 500 — trong khi "ví sàn không đủ
tiền" là tình huống **bình thường** ở giai đoạn đầu, phải trả lỗi nghiệp vụ có thông báo rõ.
`CHECK` là lưới cuối, không phải chốt chính. Repo đã có đúng khuôn này ở `order.repo.ts:146` và
`order.service.ts:250`.

### R13 — Route xem lịch sử dùng `@SkipPermissionCheck()`

**Quyết định**: route lịch sử ví của chính mình dùng `@SkipPermissionCheck()`; hai route quản trị
đi qua kiểm permission bình thường.

**Lý do**: repo chưa seed được quyền cho role non-ADMIN. Sự cố 403 ngày 2026-11-23 là hệ quả trực
tiếp. Route vẫn nằm sau `AccessTokenGuard` nên vẫn đúng Nguyên tắc II.

### R14 — Tách `WalletCoreModule` khỏi `WalletModule`

**Quyết định**: `WalletCoreModule` không có controller, `WalletModule` có.

**Lý do bắt buộc**: `TopUpCoreModule` phải import đường ghi sổ, mà `TopUpCoreModule` **đang được
`CronModule` import**. Để lọt một module có controller vào đó là route lịch sử ví lộ ra trên cổng
cron server. Tiền lệ: `src/routes/system-setting/` đã tách đúng kiểu này ở phase 1.

### R15 — Test và điều kiện CI

**Quyết định**: viết unit test cho phần tính toán thuần (phá thế hoà, bất biến ba bút toán của một
đơn), **không commit** theo quyết định của chủ repo ở PR #50. Verify chính thức theo
[quickstart.md](./quickstart.md) trên database local, chạy bản `dist`.

**Lý do chạy `dist`**: `start:dev` dùng `tsx`, không emit decorator metadata nên DTO **không được
validate**. Verify trên `start:dev` sẽ bỏ lọt mọi lỗi kiểm đầu vào.

**Cổng bắt buộc trước khi mở PR**: `lint`, `test`, `build`, **và `docker build`** — xem mục Rủi ro
của [plan.md](./plan.md).

## Phần 3 — Đã kiểm và không thành vấn đề

- **Cron server không đụng tới các đường ghi số dư.** Chỉ tiến trình API chạm vào chúng, nên không
  có đường ghi song song nào nằm ngoài tầm kiểm soát của phase này.
- **`Order` đã có khoá duy nhất trên `(customerId, idempotencyKey)`**, nên việc mua lặp đã được
  chặn từ trước; index duy nhất trên `(orderId, type)` của sổ cái là lớp thứ hai, không phải lớp
  duy nhất.
- **Quy mô backfill nhỏ.** Sau khi dọn còn khoảng 5 đơn và 6 lần nạp, sinh dưới 20 bút toán. Không
  cần chia lô.
- **Không có `.specify/extensions.yml`**, nên không hook nào chạy trong quy trình spec-kit của
  repo này.
