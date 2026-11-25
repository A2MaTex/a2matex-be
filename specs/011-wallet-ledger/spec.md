# Feature Specification: Sổ ghi biến động số dư ví và tài khoản tiền của sàn

**Feature Branch**: `feat/wallet-ledger`

**Created**: 2026-11-24 · **Cập nhật lớn**: 2026-11-25

**Status**: Draft

**Input**: User description: "Sổ ghi biến động số dư ví — phase 3 của module payout. Mọi lần số
dư thay đổi đều để lại đúng một dòng ghi chép, nói rõ vì sao thay đổi và số dư còn lại bao nhiêu
sau đó." Mở rộng ngày 2026-11-25: thêm tài khoản giữ tiền của sàn, bỏ cơ chế "số dư mở đầu", thay
bằng việc ghi lại đúng khoản quản trị viên đã cấp.

**Nguồn thiết kế**: `a2matex-docs/components/a2matex-backend/commerce_entitlement_execution/payout.md`
— mục 3 (Delivery phases, hàng Phase 3), 4.3, 5 (phần Phase 3), 8, 10, 11.3 và 11.5.

**Vị trí trong lộ trình**: phase 3 trong 4 phase của module payout. Phase 1
([009-system-setting](../009-system-setting/spec.md)) và phase 2
([010-commission-split](../010-commission-split/spec.md)) đã chạy trên production. Phase 4 (rút
tiền) **cần phase này trước**, vì nó tạo ra biến động số dư không thuộc một đơn hàng hay một lần
nạp tiền nào. Phase hoàn tiền đã bị bỏ ngày 2026-11-24 và quay lại dưới dạng một spec riêng về
**giữ tiền trong thời gian bảo hành**, nằm ngoài phase này.

**Quy ước đặt tên**: spec này gọi mọi thứ bằng tên nghiệp vụ. Định danh kỹ thuật và cơ chế lưu trữ
nằm trong [data-model.md](./data-model.md); quyết định kỹ thuật và bằng chứng từ mã nguồn nằm
trong [research.md](./research.md).

## Hiện trạng cần khắc phục

Số dư ví là một con số, không kèm lịch sử. Ba chỗ làm nó thay đổi: nạp tiền, mua hàng, và từ phase
2 là tiền bán hàng về ví nhà phát hành. Không chỗ nào để lại bản ghi riêng.

Và **tiền của sàn không có chỗ đứng nào cả**. Phần hoa hồng sàn ăn trên mỗi đơn chỉ tồn tại như
một con số trên bảng đơn hàng: khách trả nhiều hơn phần nhà phát hành nhận, và khoảng chênh đó
không được ghi vào bất kỳ tài khoản nào.

Hệ quả:

- Khách hỏi "vì sao ví tôi còn từng này" thì phải tự ghép từ hai bảng khác nhau.
- Nếu số dư bị lệch, **không ai biết** — không có gì để đối chiếu.
- Không trả lời được câu "rốt cuộc sàn đang có bao nhiêu tiền".
- Quản trị viên **đã từng đặt số dư thẳng vào dữ liệu** cho hai tài khoản — 15.994.000 ₫. Không
  bản ghi nào nói ai làm, lúc nào, vì sao, và khi đối chiếu dòng tiền thì khoản đó hiện ra như một
  con số lệch không giải thích nổi. Hai tài khoản đó là **người dùng thật** đang hoạt động, không
  phải tài khoản thử nghiệm bỏ đi (đối chiếu production 2026-11-25).
- Việc rút tiền (phase 4) và việc quản trị viên cộng tiền sẽ tạo ra biến động không gắn với đơn
  hàng hay lần nạp nào, và hiện **không có chỗ nào ghi chúng**.

## Clarifications

### Session 2026-11-24

- Q: Mỗi biến động ghi những gì? → A: Loại biến động, số tiền, chiều tăng hay giảm, **số dư còn lại
  ngay sau đó**, và nguồn gốc (đơn hàng nào, lần nạp nào).
- Q: Có dựng lại được lịch sử cũ không? → A: **Phần lớn có, nhưng không phải tất cả.** Kiểm dữ liệu
  thật ngày 2026-11-24: 8 trong 10 ví dựng lại chính xác từ dữ liệu nạp tiền và đơn hàng; 2 ví còn
  lại lệch 5.994.000 ₫ và 10.000.000 ₫.
- Q: Hai ví lệch đó là lỗi dữ liệu? → A: **Không.** Chủ repo xác nhận quản trị viên tự đặt số dư
  cho hai tài khoản đó để **thử tính năng mua hàng**. Đây là tiền thử nghiệm, không phải tiền của
  khách và không phải khoản bù cho ai.
- Q: Có làm tính năng hoàn tiền cho khách không? → A: **Không trong phase này.** Thay vào đó, quản
  trị viên **cộng tiền** vào tài khoản khi hệ thống lỗi hoặc cần bù.
- Q: Số dư có được phép âm không? → A: **Không.** Rà lại mọi đường làm giảm số dư — mua hàng và rút
  tiền đều có chặn, quản trị viên chỉ cộng chứ không trừ — nên không còn gì đẩy nó xuống âm.

### Session 2026-11-25 (thiết kế lại phần tiền của sàn)

- Q: Khoản chênh giữa dòng tiền nạp và dòng tiền rút xử lý thế nào? → A: **Không làm nó về 0.** Nó
  là nghĩa vụ không có tiền mặt đỡ sau lưng, và phải được nêu thành một dòng riêng trong báo cáo
  chứ không bị giấu đi.
- Q: Tiền của sàn lưu ở đâu? → A: **Một bảng riêng**, không thuộc về người dùng nào, không tạo tài
  khoản người dùng giả. Lý do quyết định: phép đối soát ví người dùng lọc theo "chưa bị xoá mềm",
  nên nếu ví sàn là một người dùng thì chỉ cần ai đó xoá mềm tài khoản ấy là ví sàn **lặng lẽ rơi
  khỏi phép đối soát** mà phép đối soát vẫn báo sạch. Bảng riêng không có kiểu hỏng đó và không đòi
  hỏi mọi tính năng về sau phải nhớ loại trừ nó.
- Q: Quản trị viên cộng tiền lấy từ đâu? → A: **Từ tài khoản của sàn**, thành một lần chuyển khoản
  hai chân nối với nhau. Cộng với ràng buộc không-âm, điều này có nghĩa quản trị viên **chỉ cho đi
  được phần sàn thật sự đang có**.
- Q: Vậy làm sao bù cho khách khi sàn chưa có doanh thu? → A: Thêm một chức năng **bơm tiền vào tài
  khoản của sàn**. Đây là cửa **duy nhất** tiền không có tiền mặt đối ứng đi vào hệ thống, và tổng
  các lần bơm là con số phải theo dõi.
- Q: Có tách "tiền công ty nạp thật" khỏi "tiền tạo ra để test" không? → A: **Không**, một loại duy
  nhất. Kèm cam kết vận hành: loại đó **không bao giờ** dùng cho tiền công ty chuyển thật vào ngân
  hàng. Phá cam kết mà không tách loại thì con số "tiền tự phát hành" mất ý nghĩa.
- Q: Phần số dư thử nghiệm cũ xử lý thế nào? → A: **Dọn sạch, không ghi thành "số dư mở đầu".** Cơ
  chế số dư mở đầu bị **bỏ hoàn toàn**.
- Q: Dọn thế nào, chỉ đưa số dư về 0? → A: **Không đủ.** Hai ví đó đã thực sự tiêu 218.000 ₫ và
  109.000 ₫ vào đơn hàng có thật; đưa số dư về 0 mà để nguyên đơn thì lịch sử dựng lại sẽ cho số dư
  âm và việc dựng lại thất bại. Dọn nghĩa là **xoá entitlement, xoá đơn hàng, rồi mới đưa số dư về
  0**.
- Q: Hai tài khoản test đó còn dùng không? → A: **Còn**, nhưng chủ repo chấp nhận dọn. ⚠️ **Câu
  trả lời này đã bị đảo ngày 2026-11-25** sau khi đọc dữ liệu production — xem phiên bên dưới.
- Q: Nếu còn ví lệch thì sao? → A: **Dừng việc dựng lại, báo rõ ví nào.** Không còn cơ chế bù trừ
  nào nên mọi ví phải khớp tuyệt đối. Phát hiện muộn còn đắt hơn nhiều.

### Session 2026-11-25 (đối chiếu dữ liệu production — ĐẢO quyết định dọn dữ liệu)

- Q: Hai ví lệch trên production có đúng là tài khoản thử nghiệm bỏ đi không? → A: **Không.** Đọc
  dữ liệu production ngày 2026-11-25: đó là hai địa chỉ Gmail thật, mua hàng ngày 23/11, đang giữ
  **6 quyền truy cập còn hiệu lực** (hạn tới 28/11, 30/11 và 23/12). Một trong hai đã **nạp tiền
  thật qua ngân hàng** 3 lần, tổng 6.000 ₫.
- Q: Vậy có dọn nữa không? → A: **Không.** Xoá 6 quyền đang dùng và đưa số dư về 0 là phá huỷ
  trạng thái thật của người dùng chỉ để sổ sách gọn — trong đó có cả tiền thật, dù ít.
- Q: Thay bằng gì? → A: **Ghi lại đúng việc đã xảy ra.** Quản trị viên đã cấp 15.994.000 ₫ cho hai
  ví đó, nên sổ cái ghi: một khoản hệ thống tự phát hành vào tài khoản của sàn, rồi hai lần chuyển
  khoản từ đó sang hai ví. Tổng khớp, không ai mất gì, và con số 15.994.000 ₫ hiện ra đúng chỗ của
  nó trong báo cáo dòng tiền.
- Q: `createdById` điền ai? → A: Tài khoản quản trị viên thật đã làm việc đó. Lý do bác bỏ phương
  án này hôm 2026-11-24 là "không ai biết admin nào làm" — nay đã xác định được, nên lý do đó không
  còn.
- Q: Làm thế thì có mất chốt dừng không? → A: **Không**, vì danh sách ví được ghi lại là **cố định
  và có giới hạn**. Ví nào khác còn lệch thì chốt dừng vẫn nổ.
- Q: Đã kiểm chưa? → A: **Rồi, trên chính dữ liệu production**, chạy trong transaction rồi
  `ROLLBACK` hai lần ngày 2026-11-25. Cả bốn phép đối soát ra 0 dòng và đẳng thức dòng tiền đúng:
  `36.000 + 15.994.000 = 15.701.000 + 329.000`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Giải thích được số dư của mình (Priority: P1)

Người dùng mở lịch sử ví và thấy từng lần số dư thay đổi: nạp tiền vào, mua hàng trừ đi, bán hàng
cộng vào, quản trị viên bù tiền cộng vào — mỗi dòng kèm số tiền, chiều, và số dư còn lại ngay sau
lần đó. Cộng dồn từ đầu tới cuối ra đúng số dư đang hiển thị.

**Why this priority**: đây là lý do sổ cái tồn tại. Không có nó thì "ví tôi còn bao nhiêu" là một
con số không ai kiểm chứng được.

**Independent Test**: nạp tiền rồi mua một món, mở lịch sử ví, kiểm hai dòng mới và số dư cuối khớp
với số dư thật.

**Acceptance Scenarios**:

1. **Given** người dùng vừa nạp tiền, **When** mở lịch sử ví, **Then** thấy một dòng tăng đúng số
   tiền đã nạp, kèm số dư sau đó.
2. **Given** người dùng vừa mua một sản phẩm, **When** mở lịch sử, **Then** thấy một dòng giảm đúng
   giá đã trả.
3. **Given** nhà phát hành vừa bán được hàng, **When** mở lịch sử, **Then** thấy một dòng tăng đúng
   phần mình nhận.
4. **Given** toàn bộ lịch sử của một ví, **When** cộng các khoản tăng trừ các khoản giảm, **Then**
   ra **đúng** số dư hiện tại.
5. **Given** hai người dùng khác nhau, **When** một người mở lịch sử, **Then** chỉ thấy biến động
   của chính mình.

---

### User Story 2 - Tiền của sàn có chỗ đứng (Priority: P2)

Phần hoa hồng sàn ăn trên mỗi đơn được ghi vào một tài khoản riêng của sàn, như một biến động có
nguồn gốc là chính đơn hàng đó. Người vận hành trả lời được câu "sàn đang có bao nhiêu tiền" bằng
một con số, và truy được nó đến từng đơn.

**Why this priority**: không có nó thì mỗi đơn hàng là một chỗ rò — khách trả nhiều hơn nhà phát
hành nhận, phần chênh bốc hơi khỏi sổ sách. Và mọi chức năng về sau liên quan tới tiền của sàn
(quản trị viên cộng tiền, rút lợi nhuận) đều không có chỗ bấu víu.

**Independent Test**: mua một sản phẩm có tỉ lệ hoa hồng khác 0, kiểm tài khoản của sàn tăng đúng
phần hoa hồng, và tổng ba biến động của đơn đó bằng 0.

**Acceptance Scenarios**:

1. **Given** một đơn hàng có hoa hồng lớn hơn 0, **When** khách thanh toán xong, **Then** tài khoản
   của sàn tăng đúng phần hoa hồng, kèm một bản ghi trỏ về đơn đó.
2. **Given** một đơn hàng bất kỳ, **When** cộng khoản trừ của khách với khoản cộng của nhà phát
   hành và khoản cộng của sàn, **Then** chúng **triệt tiêu nhau** — tiền không sinh ra, không mất
   đi.
3. **Given** một đơn có tỉ lệ hoa hồng bằng 0, **When** khách thanh toán, **Then** không bản ghi
   hoa hồng nào được tạo.
4. **Given** toàn bộ lịch sử của tài khoản sàn, **When** cộng dồn, **Then** ra đúng số dư của tài
   khoản đó.

---

### User Story 3 - Phát hiện được số dư lệch (Priority: P3)

Người vận hành chạy một bộ phép đối soát và biết ngay có tài khoản nào — ví người dùng hay tài
khoản của sàn — đang mang số dư không giải thích được bằng lịch sử của nó hay không.

**Why this priority**: sổ cái mà không ai đối chiếu thì chỉ là thêm dữ liệu. Nhưng tiền vẫn chạy
đúng dù chưa có phép đối soát này, nên nó đứng sau.

**Independent Test**: thay đổi số dư một ví bằng công cụ thao tác dữ liệu trực tiếp, chạy đối soát,
và thấy đúng ví đó hiện ra.

**Acceptance Scenarios**:

1. **Given** hệ thống đang khớp, **When** chạy đối soát, **Then** không tài khoản nào hiện ra.
2. **Given** một ví bị đổi số dư ngoài mọi đường đi của ứng dụng, **When** chạy đối soát, **Then**
   đúng ví đó hiện ra kèm mức chênh.
3. **Given** tài khoản của sàn bị đổi số dư ngoài ứng dụng, **When** chạy đối soát, **Then** nó
   hiện ra — và phép kiểm này **không bị ảnh hưởng** bởi việc bất kỳ bản ghi nào bị xoá mềm.
4. **Given** một đơn hàng, **When** đối chiếu các biến động gắn với nó, **Then** khoản khách bị
   trừ, khoản nhà phát hành nhận và khoản sàn nhận đều khớp với con số đã ghi **trên chính đơn**.
5. **Given** một lần quản trị viên cộng tiền, **When** đối chiếu, **Then** nó có đúng hai chân và
   hai chân bằng nhau về số tiền.
6. **Given** toàn hệ thống, **When** chạy báo cáo dòng tiền, **Then** thấy tách bạch: tiền mặt đã
   nhận, hoa hồng thu được, **tiền hệ thống tự phát hành**, nghĩa vụ với người dùng, và số dư tài
   khoản sàn.

---

### User Story 4 - Lịch sử cũ dựng lại đúng, không bù trừ (Priority: P4)

Những ví đã tồn tại trước khi có sổ cái vẫn có lịch sử đầy đủ, dựng lại từ dữ liệu nạp tiền và đơn
hàng. Phần số dư quản trị viên đặt thẳng vào dữ liệu được **ghi lại thành bút toán đúng với việc
đã xảy ra**, nên không còn gì phải bù trừ và không ai mất gì.

**Why this priority**: không có phần này thì sổ cái chỉ đúng với tiền phát sinh từ nay về sau, và
mọi ví cũ sẽ hiện sai.

**Independent Test**: sau khi triển khai, cộng dồn lịch sử của **mọi** tài khoản và so với
số dư thật của chúng.

**Acceptance Scenarios**:

1. **Given** một ví có lịch sử nạp tiền và mua hàng đầy đủ, **When** xem lịch sử sau triển khai,
   **Then** thấy lại đúng các biến động đó, đúng thứ tự thời gian.
2. **Given** mọi tài khoản trong hệ thống, **When** cộng dồn lịch sử từng cái, **Then** **100%**
   khớp với số dư thật, không tài khoản nào lệch.
3. **Given** một ví chưa từng có biến động nào, **When** xem lịch sử, **Then** rỗng và số dư bằng
   0, không có bản ghi thừa nào.
4. **Given** còn một ví lệch ngoài danh sách đã xác nhận, **When** chạy việc dựng lại, **Then** nó **dừng lại** kèm
   thông báo chỉ rõ ví nào, chứ không âm thầm bỏ qua.
5. **Given** việc dựng lại đã chạy xong, **When** chạy lại lần nữa, **Then** không bản ghi nào bị
   nhân đôi và kết quả không đổi.

---

### User Story 5 - Quản trị viên bù tiền cho người dùng (Priority: P5)

Hệ thống lỗi làm khách mất tiền oan, hoặc cần bù cho ai đó. Quản trị viên cộng tiền vào ví người
đó kèm lý do. Khoản tiền ấy **được lấy từ tài khoản của sàn**, và lần cộng hiện ra trong lịch sử ví
của người nhận như mọi biến động khác.

**Why this priority**: thay thế cho tính năng hoàn tiền đã bỏ, và là cách duy nhất để sửa sai mà
không phải can thiệp thẳng vào dữ liệu. Nhưng nó dựa hoàn toàn vào sổ cái và vào tài khoản của sàn
nên phải đứng sau cả hai.

**Independent Test**: cộng tiền cho một tài khoản, kiểm số dư người nhận tăng đúng, số dư tài khoản
sàn giảm đúng, và cả hai bản ghi nối được với nhau.

**Acceptance Scenarios**:

1. **Given** tài khoản của sàn có đủ tiền, **When** quản trị viên cộng một khoản kèm lý do,
   **Then** ví người nhận tăng đúng khoản đó và tài khoản của sàn giảm đúng khoản đó.
2. **Given** lần cộng vừa thực hiện, **When** xem lại, **Then** thấy **hai** bản ghi đối ứng nối
   với nhau, và truy được ai cộng, lúc nào, lý do gì.
3. **Given** tài khoản của sàn **không đủ tiền**, **When** quản trị viên cộng, **Then** bị từ chối
   với thông báo nghiệp vụ rõ ràng, **không phải lỗi hệ thống**, và không số dư nào thay đổi.
4. **Given** một người dùng thường, **When** gọi chức năng cộng tiền, **Then** bị từ chối và không
   số dư nào thay đổi.
5. **Given** quản trị viên nhập số tiền bằng 0 hoặc âm, hoặc không nhập lý do, **When** gửi,
   **Then** bị từ chối.
6. **Given** người nhận là tài khoản đã bị xoá, **When** quản trị viên cộng, **Then** bị từ chối,
   không tạo bản ghi mồ côi.
7. **Given** một lần cộng tiền, **When** chạy đối soát, **Then** không tài khoản nào lệch.

---

### User Story 6 - Quản trị viên bơm tiền vào tài khoản của sàn (Priority: P6)

Khi sàn chưa có đủ doanh thu để bù cho khách hoặc để chạy thử, quản trị viên bơm một khoản vào tài
khoản của sàn kèm lý do. Đây là lần duy nhất trong toàn hệ thống mà tiền xuất hiện mà không có đồng
nào vào tài khoản ngân hàng.

**Why this priority**: nó là điều kiện để User Story 5 dùng được trong giai đoạn đầu, nhưng bản
thân nó không mang lại giá trị trực tiếp cho người dùng cuối nên đứng cuối.

**Independent Test**: bơm một khoản vào tài khoản của sàn, kiểm số dư tăng đúng, và kiểm khoản đó
hiện ra trong báo cáo ở dòng "tiền hệ thống tự phát hành".

**Acceptance Scenarios**:

1. **Given** tài khoản của sàn có số dư bất kỳ, **When** quản trị viên bơm một khoản kèm lý do,
   **Then** số dư tăng đúng khoản đó và có một bản ghi mới.
2. **Given** lần bơm vừa thực hiện, **When** xem lại, **Then** truy được ai làm, lúc nào, lý do gì.
3. **Given** quản trị viên không nhập lý do, hoặc nhập số tiền không lớn hơn 0, **When** gửi,
   **Then** bị từ chối.
4. **Given** một người dùng thường, **When** gọi chức năng này, **Then** bị từ chối.
5. **Given** đã có vài lần bơm, **When** chạy báo cáo dòng tiền, **Then** tổng các lần bơm hiện ra
   thành **một dòng riêng**, không lẫn vào doanh thu hay tiền mặt.

---

### Edge Cases

- **Số dư âm** → không được tồn tại ở bất kỳ tài khoản nào. Mọi đường làm giảm số dư đều có chặn,
  và hệ thống phải từ chối cả khi ai đó ghi số âm bằng công cụ thao tác dữ liệu trực tiếp.
- **Tài khoản của sàn không đủ tiền khi quản trị viên cộng** → từ chối như lỗi nghiệp vụ, kèm
  thông báo nói rõ phải bơm tiền vào trước. Đây là tình huống **bình thường** ở giai đoạn đầu, không
  phải sự cố.
- **Quản trị viên cộng tiền cho tài khoản đã bị xoá** → từ chối, không tạo bản ghi mồ côi.
- **Biến động số tiền bằng 0** → không ghi dòng nào. Hàng miễn phí, hoặc đơn có tỉ lệ hoa hồng bằng
  0, không làm số dư đổi nên không có gì để ghi.
- **Một lần nạp hoặc một đơn hàng bị ghi sổ hai lần** → hệ thống phải từ chối lần thứ hai.
- **Ghi sổ thất bại giữa chừng** → số dư cũng không được đổi. Hai thứ phải cùng xảy ra hoặc cùng
  không. Áp dụng cho cả hai chân của một lần chuyển khoản.
- **Một lần chuyển khoản chỉ ghi được một chân** → không được tồn tại; đối soát phải bắt được.
- **Dọn dữ liệu chưa sạch, vẫn còn ví lệch** → việc dựng lại lịch sử **dừng lại** kèm thông báo chỉ
  rõ ví nào, không âm thầm bỏ qua và không tự bù trừ.
- **Ví mà lịch sử cộng ra nhiều hơn số dư thật** → cũng dừng. Không còn cơ chế bù trừ chiều âm, và
  quản trị viên trừ tiền nằm ngoài phạm vi, nên không có đường nào xử lý tự động.
- **Chạy lại việc dựng lịch sử lần hai** → không được nhân đôi dữ liệu.

## Requirements *(mandatory)*

### Functional Requirements

**Ghi nhận biến động**

- **FR-001**: Mỗi lần số dư của một tài khoản — ví người dùng hoặc tài khoản của sàn — thay đổi, hệ
  thống PHẢI ghi đúng một bản ghi mô tả lần thay đổi đó.
- **FR-002**: Mỗi bản ghi PHẢI có: loại biến động, số tiền, chiều tăng hay giảm, số dư của tài
  khoản ngay sau biến động, và thời điểm.
- **FR-003**: Bản ghi PHẢI chỉ ra nguồn gốc của biến động khi có — lần nạp tiền nào, hay đơn hàng
  nào.
- **FR-004**: Số tiền trên bản ghi PHẢI luôn là số dương; việc tăng hay giảm nằm ở chiều, không nằm
  ở dấu của số tiền.
- **FR-005**: Số dư ghi lại PHẢI lấy từ chính thao tác đã thay đổi số dư, không được tính riêng ra
  rồi ghi vào.
- **FR-006**: Việc ghi sổ và việc đổi số dư PHẢI cùng thành công hoặc cùng không xảy ra.
- **FR-007**: Biến động có số tiền bằng 0 PHẢI không tạo bản ghi nào.
- **FR-008**: Một lần nạp tiền hoặc một đơn hàng PHẢI không thể được ghi sổ hai lần.
- **FR-009**: Số dư PHẢI không bao giờ âm — áp dụng cho ví người dùng, tài khoản của sàn, và cả số
  dư-sau ghi trong từng bản ghi. Hệ thống PHẢI không lưu được số dư âm kể cả khi ghi bằng công cụ
  thao tác dữ liệu trực tiếp.

**Tài khoản tiền của sàn**

- **FR-010**: Hệ thống PHẢI có một tài khoản riêng giữ tiền của sàn. Tài khoản đó PHẢI **không
  thuộc về** bất kỳ người dùng nào.
- **FR-011**: Tài khoản của sàn PHẢI xuất hiện trong sổ cái như mọi tài khoản khác, với cùng cách
  ghi và cùng bất biến.
- **FR-012**: Mỗi đơn hàng có hoa hồng lớn hơn 0 PHẢI ghi phần hoa hồng vào tài khoản của sàn, dưới
  dạng một biến động có nguồn gốc là chính đơn hàng đó.
- **FR-013**: Mỗi bản ghi PHẢI thuộc về **đúng một** tài khoản — hoặc một ví người dùng, hoặc tài
  khoản của sàn; không bao giờ cả hai và không bao giờ không có.
- **FR-014**: Với mỗi đơn hàng, khoản trừ của khách PHẢI bằng tổng khoản cộng cho nhà phát hành và
  khoản cộng cho sàn.

**Loại biến động**

- **FR-015**: Phase này PHẢI ghi nhận được sáu loại: nạp tiền, mua hàng, tiền bán hàng, hoa hồng
  của sàn, quản trị viên cộng tiền, và quản trị viên bơm tiền vào tài khoản của sàn.
- **FR-016**: Mỗi loại PHẢI có chiều cố định và PHẢI thuộc đúng một phía — ví người dùng hay tài
  khoản của sàn. Ngoại lệ duy nhất là quản trị viên cộng tiền: nó có hai chân, một ở mỗi phía.
- **FR-017**: Cách tổ chức PHẢI cho phép bổ sung loại biến động mới ở phase sau mà không phải sửa
  bản ghi đã có.

**Dọn dữ liệu và dựng lại lịch sử**

- **FR-018**: Phần số dư mà quản trị viên đã đặt thẳng vào dữ liệu trước khi có sổ cái PHẢI được
  **ghi lại thành bút toán đúng với việc đã xảy ra** — một khoản hệ thống tự phát hành vào tài
  khoản của sàn, rồi chuyển từ đó sang ví người nhận. PHẢI **không** xoá đơn hàng, quyền truy cập
  hay số dư của những người đó.
- **FR-019**: Việc ghi lại đó PHẢI giới hạn trong một **danh sách ví cụ thể đã được xác nhận**, để
  nó không trở thành cách lách hai chốt dừng ở FR-021. Vì danh sách ấy là định danh của người dùng
  thật, bước ghi lại PHẢI **không nằm trong mã nguồn được commit**; nó chạy một lần trên môi trường
  có dữ liệu đó. Mọi môi trường khác PHẢI chạy được mà không cần bước này.
- **FR-020**: Mọi ví PHẢI có lịch sử dựng lại từ dữ liệu nạp tiền, đơn hàng và các khoản ghi lại ở
  FR-018, và tổng lịch sử PHẢI bằng **đúng** số dư thật.
- **FR-021**: Nếu còn bất kỳ tài khoản nào **ngoài danh sách ở FR-019** mà lệch, hoặc có ví nào
  lịch sử cộng ra nhiều hơn số dư thật, việc dựng lại PHẢI **dừng** kèm thông báo chỉ rõ tài khoản
  nào.
- **FR-022**: Tài khoản của sàn PHẢI nhận số dư ban đầu bằng tổng hoa hồng của mọi đơn hàng, ghi
  thành **từng biến động gắn với từng đơn**, không phải một khoản gộp.
- **FR-023**: Khoản hệ thống tự phát hành ở FR-018 PHẢI được ghi có vào tài khoản của sàn **trước**
  khi chuyển đi, để số dư tài khoản đó không đi qua vùng âm ở bất kỳ thời điểm nào.
- **FR-024**: Việc dựng lại lịch sử PHẢI chạy lại được mà không nhân đôi dữ liệu, kể cả phần ghi
  lại ở FR-018.

**Xem và đối soát**

- **FR-025**: Người dùng PHẢI xem được lịch sử biến động ví của chính mình, mới nhất trước.
- **FR-026**: Người dùng PHẢI chỉ xem được lịch sử của chính mình; không có tham số nào cho phép
  xem của người khác.
- **FR-027**: Người vận hành PHẢI có cách phát hiện ví người dùng nào đang có số dư không khớp với
  lịch sử của nó.
- **FR-028**: Người vận hành PHẢI có cách phát hiện tài khoản của sàn có số dư không khớp lịch sử,
  và phép kiểm này PHẢI **không bị ảnh hưởng** bởi việc bất kỳ bản ghi nào bị xoá mềm.
- **FR-029**: Người vận hành PHẢI có cách phát hiện đơn hàng nào có biến động không khớp với các
  con số ghi trên **chính đơn hàng đó**.
- **FR-030**: Người vận hành PHẢI có cách phát hiện lần chuyển khoản nào thiếu chân, thừa chân,
  hoặc hai chân lệch số tiền.
- **FR-031**: Người vận hành PHẢI xem được một báo cáo dòng tiền gồm năm con số tách bạch: tiền mặt
  đã nhận, hoa hồng thu được, **tiền hệ thống tự phát hành**, tổng nghĩa vụ với người dùng, và số dư
  tài khoản của sàn.

**Quyền**

- **FR-032**: Mọi chức năng mới PHẢI yêu cầu đăng nhập. Chức năng chỉ dành cho quản trị viên PHẢI
  có permission riêng.
- **FR-033**: Sau khi phân quyền cho chức năng mới, người dùng hợp lệ PHẢI dùng được ngay, không bị
  từ chối vì cache quyền cũ.

**Quản trị viên cộng tiền cho người dùng**

- **FR-034**: Quản trị viên PHẢI cộng được tiền vào ví của một người dùng bất kỳ.
- **FR-035**: Khoản cộng PHẢI được lấy **từ tài khoản của sàn**, và PHẢI để lại hai bản ghi đối ứng
  nối được với nhau: một khoản giảm ở tài khoản của sàn, một khoản tăng ở ví người nhận.
- **FR-036**: Nếu tài khoản của sàn không đủ tiền, việc cộng PHẢI bị từ chối như một **lỗi nghiệp
  vụ** có thông báo rõ ràng — không phải lỗi hệ thống — và không số dư nào được thay đổi.
- **FR-037**: Mỗi lần cộng PHẢI ghi lại **lý do** và **người thực hiện**, và cả hai PHẢI bắt buộc.
- **FR-038**: Số tiền cộng PHẢI lớn hơn 0. Không có chức năng trừ tiền ở phase này.
- **FR-039**: Chỉ quản trị viên PHẢI làm được việc này; người dùng thường PHẢI bị từ chối.
- **FR-040**: Cộng tiền cho tài khoản đã bị xoá PHẢI bị từ chối.
- **FR-041**: Việc cộng tiền và việc ghi cả hai bản ghi PHẢI cùng thành công hoặc cùng không xảy
  ra.

**Quản trị viên bơm tiền vào tài khoản của sàn**

- **FR-042**: Quản trị viên PHẢI bơm được tiền vào tài khoản của sàn.
- **FR-043**: Đây PHẢI là đường **duy nhất** để tiền không có tiền mặt đối ứng đi vào hệ thống.
- **FR-044**: Mỗi lần bơm PHẢI ghi lại **lý do** và **người thực hiện**, và cả hai PHẢI bắt buộc.
- **FR-045**: Số tiền bơm PHẢI lớn hơn 0.
- **FR-046**: Chỉ quản trị viên PHẢI làm được việc này.
- **FR-047**: Tổng các lần bơm PHẢI tổng hợp được thành **một con số riêng** trong báo cáo dòng
  tiền, không lẫn với doanh thu hay với tiền mặt khách nạp.

### Key Entities

- **Biến động số dư**: một lần số dư của một tài khoản thay đổi. Gồm tài khoản chủ, loại biến động,
  số tiền, chiều, số dư ngay sau đó, nguồn gốc nếu có, và thời điểm. Ghi một lần, không sửa, không
  xoá — đây là bản ghi lịch sử, không phải trạng thái.
- **Ví người dùng**: số dư hiện tại của một người. Sổ cái **giải thích** nó chứ không thay thế nó:
  số dư vẫn là nguồn đúng về "còn bao nhiêu", sổ cái là nguồn đúng về "vì sao".
- **Tài khoản của sàn**: nơi giữ tiền thuộc về sàn. Không thuộc về người dùng nào. Nhận tiền từ hoa
  hồng mỗi đơn và từ các lần quản trị viên bơm vào; chi ra khi quản trị viên cộng tiền cho người
  dùng.
- **Lần chuyển khoản**: một sự kiện làm tiền đổi chủ giữa hai tài khoản bên trong hệ thống, để lại
  **hai** biến động đối ứng nối với nhau. Hiện chỉ dùng cho việc quản trị viên cộng tiền.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% số tài khoản trong hệ thống — ví người dùng và tài khoản của sàn — có tổng lịch
  sử bằng đúng số dư thật, ngay sau khi triển khai.
- **SC-002**: Mọi lần số dư thay đổi từ nay về sau đều để lại đúng một bản ghi — không thiếu, không
  trùng.
- **SC-003**: Người dùng truy được lý do của từng lần số dư thay đổi mà không cần ai tra cứu hộ.
- **SC-004**: Một thay đổi số dư thực hiện ngoài ứng dụng — ở ví người dùng hoặc ở tài khoản của
  sàn — bị phép đối soát phát hiện.
- **SC-005**: Một thao tác bị lặp lại không bao giờ làm lịch sử ghi hai lần cùng một biến động.
- **SC-006**: Không người dùng nào xem được lịch sử ví của người khác.
- **SC-007**: Việc dựng lại lịch sử chạy nhiều lần cho ra cùng một kết quả.
- **SC-008**: Không tồn tại tài khoản nào có số dư âm, kể cả khi ghi bằng công cụ thao tác dữ liệu
  trực tiếp.
- **SC-009**: Mọi lần quản trị viên cộng tiền hoặc bơm tiền đều truy được ra người thực hiện, thời
  điểm và lý do.
- **SC-010**: Mọi đồng trong hệ thống quy được về đúng một trong ba nguồn — tiền mặt khách nạp, hoa
  hồng sàn thu, hoặc tiền hệ thống tự phát hành — và con số thứ ba đọc được bằng **một** truy vấn.
- **SC-011**: Tổng số tiền quản trị viên đã cộng cho người dùng không bao giờ vượt quá tổng số tiền
  đã vào tài khoản của sàn.
- **SC-012**: Với mỗi đơn hàng, ba biến động của nó triệt tiêu nhau — không đơn nào làm tiền sinh
  ra hoặc mất đi.

## Assumptions

- Số dư vẫn là nguồn đúng về "còn bao nhiêu tiền". Sổ cái giải thích nó, không thay thế nó, và
  phase này không đổi cách tính số dư.
- Hai ví có số dư do quản trị viên đặt trực tiếp (chênh 5.994.000 ₫ và 10.000.000 ₫) là **tiền thử
  nghiệm để kiểm tra tính năng mua hàng**, chủ repo xác nhận ngày 2026-11-24.
- Hai tài khoản đó là **người dùng thật đang hoạt động**, không phải tài khoản thử nghiệm bỏ đi:
  6 quyền truy cập còn hiệu lực, và một trong hai đã nạp tiền thật 6.000 ₫ (đối chiếu production
  2026-11-25). Vì vậy **không xoá gì của họ**; phần số dư được ghi lại thành bút toán thay vì bị
  dọn đi.
- Đơn hàng trong hệ thống hiện được thiết kế là **không sửa, không xoá**. Việc dọn là một ngoại lệ
  cố ý, thực hiện một lần, và phải được ghi lại trong tài liệu vận hành.
- Việc dọn làm **giảm doanh thu đã ghi nhận của kỳ đã qua** đúng phần hoa hồng của các đơn bị xoá.
  Ở quy mô hiện tại khoản này không đáng kể.
- Sau phase này, quản trị viên **có đường chính thức** để cộng tiền, nên không còn lý do đặt số dư
  trực tiếp vào dữ liệu. Nếu vẫn có người làm vậy, phép đối soát sẽ phát hiện.
- Chức năng bơm tiền vào tài khoản của sàn **không bao giờ** được dùng cho tiền công ty chuyển thật
  vào tài khoản ngân hàng. Đây là cam kết vận hành, không phải ràng buộc kỹ thuật. Ngày nào nghiệp
  vụ đó phát sinh thì phải tách thành một loại riêng **trước khi** dùng.
- Phép đối soát là công cụ vận hành chạy khi cần, chưa cần tự động hoá hay cảnh báo.
- Quy mô hiện tại là 10 ví, 6 lần nạp tiền và 7 đơn hàng, nên việc dựng lại lịch sử chạy một lần là
  đủ, chưa cần chia lô.
- Lịch sử ví không cần lọc theo khoảng thời gian ở phase này; phân trang là đủ.

## Out of Scope

- Rút tiền về ngân hàng — phase 4.
- **Giữ tiền trong thời gian bảo hành và hoàn tiền cho khách** — là một spec riêng sau phase này.
  Thiết kế của phase này **không cản** việc đó: loại biến động thêm được mà không đụng bản ghi cũ,
  và đơn hàng cũ giữ nguyên dạng đã ghi.

  **Hình dạng đã chốt cho spec đó** (ghi lại ngày 2026-11-25 để người viết spec sau không phải
  dựng lại từ đầu):

  - Khi khách mua, **toàn bộ** số tiền đơn hàng vào tài khoản của sàn và bị đánh dấu là đang giữ —
    kể cả phần hoa hồng. Giữ cả hoa hồng là bắt buộc nếu hoàn tiền là hoàn đủ giá: hoa hồng đã ghi
    nhận rồi mà bị tiêu mất thì lúc hoàn tiền sẽ không đủ, và ràng buộc không-âm biến chuyện đó
    thành lỗi cứng đúng lúc tệ nhất.
  - Tài khoản của sàn mang **hai** con số: tổng tiền đang có, và phần đang giữ hộ. Phần tiêu được
    là hiệu hai số, và hệ thống PHẢI không cho tổng tiền tụt xuống dưới phần đang giữ.
  - Mọi đường **chi tiêu tự do** từ tài khoản của sàn (quản trị viên cộng tiền, sau này là rút lợi
    nhuận) phải kiểm phần tiêu được, không phải tổng số dư. Hai đường **giải phóng** — trả nhà phát
    hành khi hết bảo hành, và hoàn tiền cho khách trong hạn — là ngoại lệ, vì chúng giảm cả hai con
    số cùng lúc.
  - Khi hết hạn bảo hành, việc giải phóng để lại **ba** biến động: một khoản giảm ở tài khoản của
    sàn bằng nguyên giá đơn, một khoản cộng cho nhà phát hành, và một khoản hoa hồng cho sàn. Viết
    thành ba chứ không phải một khoản giảm gộp, **vì hoa hồng phải còn là một loại biến động tra
    cứu được** — nếu để nó là phần dư còn lại thì báo cáo hoa hồng mất đường tính.
  - Số ngày bảo hành là **của từng gói bán**, và phải được chụp lại vào đơn hàng lúc khách trả
    tiền. Đọc lại từ gói bán vào lúc giải phóng sẽ cho nhà phát hành rút ngắn hạn bảo hành của
    những đơn đã bán rồi.
  - Phải có một phép đối soát: phần đang giữ hộ bằng đúng tổng giá trị các đơn chưa được giải
    phóng. Đây là phép kiểm bắt lỗi dễ xảy ra nhất của luồng đó — giải phóng tiền cho nhà phát hành
    xong nhưng quên trừ phần đang giữ.
  - **Hoàn tiền là hoàn ĐỦ GIÁ, sàn không giữ lại hoa hồng** (chủ repo chốt 2026-11-25). Đây
    là điều kiện làm cho thiết kế trên đứng vững: giữ cả hoa hồng trong escrow chỉ hợp lý
    với phương án này. Kéo theo ba hệ quả phải xử lý trong spec đó:
    - Một đơn bị hoàn thì **sàn không thu được gì** — không có phí xử lý. Hoàn tiền là một
      lần đảo ngược sạch, không phải một lần chia lại.
    - Hoa hồng chỉ được **ghi nhận là doanh thu** khi hết hạn bảo hành, không phải lúc bán.
      Trước đó nó là khoản chờ, có thể phải trả lại nguyên vẹn.
    - **Quyền truy cập phải bị thu hồi** khi hoàn tiền, nếu không khách giữ sản phẩm miễn
      phí. Cơ chế đã có sẵn: `EntitlementStatus.REVOKED` cùng `revokedAt`/`revokedById`.
      Đây là điểm dễ quên nhất vì nó nằm ở module khác hẳn với tiền.
    - Chấp nhận trước: khách dùng gần hết hạn bảo hành rồi mới hoàn thì vẫn được hoàn đủ.
      Đó là nghĩa của hai chữ "bảo hành", không phải lỗ hổng.
- Quản trị viên **trừ** tiền khỏi ví người dùng. Phase này chỉ cộng.
- Rút lợi nhuận từ tài khoản của sàn về tài khoản công ty.
- Tách riêng loại "tiền công ty nạp thật" khỏi "tiền tạo ra để thử nghiệm".
- Hạn mức hoặc quy trình phê duyệt cho việc bơm tiền vào tài khoản của sàn.
- Ngăn quản trị viên thay đổi số dư trực tiếp bằng công cụ dữ liệu.
- Tự động cảnh báo khi đối soát phát hiện lệch.
- Xuất lịch sử ví ra tệp, lọc theo khoảng thời gian, hoặc tìm kiếm trong lịch sử.
- Dựng lại số dư từ sổ cái (sổ cái giải thích số dư, không phải nguồn tính ra nó).
