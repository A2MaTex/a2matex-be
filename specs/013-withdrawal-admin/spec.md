# Feature Specification: Quản trị viên duyệt đơn rút tiền và xem sổ cái

**Feature Branch**: `feat/withdrawal-admin` (tách từ `staging`)

**Created**: 2026-11-27

**Status**: Draft

**Input**: User description: "Quản trị viên duyệt đơn rút tiền và xem sổ cái toàn hệ thống"

---

## Bối cảnh

Spec 012 lên production ngày 2026-11-27 cho nhà phát hành tạo đơn rút tiền. Tiền bị trừ khỏi ví
họ **ngay lúc tạo đơn**, và đơn nằm ở trạng thái chờ duyệt.

**Nhưng không có đường nào xử lý tiếp.** Đơn đầu tiên ai đó tạo ra sẽ là tiền kẹt: đã rời ví nhà
phát hành, chưa tới ngân hàng của họ, và không ai trong hệ thống nhìn thấy hay xử lý được. Spec
này đóng vòng đó.

Đi kèm là một khoảng trống đã tồn tại từ lâu và nay thành cấp bách: **quản trị viên không có bất
kỳ đường nào để đọc dữ liệu tiền**. Hai route quản trị hiện có (`cộng tiền cho người dùng`, `bơm
tiền vào tài khoản sàn`) đều chỉ GHI. Không ai xem được sổ cái toàn hệ thống, ví của một người
dùng cụ thể, hay số dư tài khoản sàn — tất cả phải truy vấn database bằng tay.

Điều đó đặc biệt nguy hiểm với tính năng này: **duyệt chi là công ty bỏ tiền thật ra**, mà hiện
tại quản trị viên bấm duyệt trong tình trạng không nhìn thấy gì.

### Một con số định hình cả spec này

| | |
|---|---|
| Tiền mặt thật đã vào hệ thống từ trước tới nay | **36.000đ** |
| Tiền tự phát hành để thử nghiệm | **15.994.000đ** |

Gần như toàn bộ số dư trong ví nhà phát hành đến từ vế thứ hai — tiền được tạo ra, không có đồng
nào vào ngân hàng đối ứng. Khi họ xin rút, công ty chuyển **tiền thật** ra để trả cho nghĩa vụ
phần lớn chưa từng có tiền thật đi vào.

Không có cơ chế tự động nào ngăn được chuyện đó, và spec này **cố ý không tạo ra một cơ chế như
vậy** — quyết định cuối cùng thuộc về người bấm duyệt. Nhiệm vụ của spec này là làm cho người đó
**nhìn thấy sự thật trước khi bấm**.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Quản trị viên duyệt và chi một đơn rút tiền (Priority: P1)

Một nhà phát hành đã xin rút tiền. Quản trị viên mở danh sách đơn chờ, xem số tiền và thông tin
ngân hàng, bấm duyệt. Sau đó họ ra ngân hàng chuyển khoản tay, quay lại nhập mã giao dịch và đánh
dấu đơn đã chi.

**Why this priority**: không có nó thì tiền của nhà phát hành kẹt vĩnh viễn ở trạng thái chờ —
đã rời ví họ nhưng chưa tới ngân hàng. Đây là lý do spec này tồn tại.

**Independent Test**: tạo một đơn rút tiền bằng tài khoản nhà phát hành, rồi bằng tài khoản quản
trị viên: thấy đơn trong danh sách → duyệt → đánh dấu đã chi. Kiểm ba thứ: trạng thái đơn đi đúng
đường, mã giao dịch được lưu, và **số dư nhà phát hành không đổi ở cả hai bước**.

**Acceptance Scenarios**:

1. **Given** một đơn rút 200.000đ đang chờ duyệt,
   **When** quản trị viên xem danh sách đơn chờ,
   **Then** thấy đơn đó kèm số tiền, thông tin ngân hàng, tên nhà phát hành và thời điểm tạo.

2. **Given** một đơn đang chờ duyệt,
   **When** quản trị viên duyệt,
   **Then** đơn chuyển sang trạng thái đã duyệt, ghi lại ai duyệt và lúc nào, **số dư nhà phát
   hành không đổi**, và **không có bút toán sổ cái nào được sinh ra**.

3. **Given** một đơn đã duyệt,
   **When** quản trị viên đánh dấu đã chi kèm mã giao dịch ngân hàng,
   **Then** đơn chuyển sang trạng thái đã chi, mã giao dịch được lưu, số dư vẫn không đổi và vẫn
   không có bút toán nào.

4. **Given** một đơn **đang chờ duyệt** (chưa duyệt),
   **When** quản trị viên đánh dấu đã chi,
   **Then** hệ thống từ chối — phải duyệt trước đã.

5. **Given** một đơn đã chi,
   **When** quản trị viên duyệt lại hoặc đánh dấu chi lại,
   **Then** hệ thống từ chối vì đơn không còn ở trạng thái cho phép.

6. **Given** quản trị viên đánh dấu đã chi mà **không nhập mã giao dịch**,
   **Then** hệ thống từ chối — một lần chi tiền thật phải có chứng từ đối chiếu.

---

### User Story 2 — Quản trị viên nhìn thấy nguồn gốc tiền trước khi duyệt (Priority: P1)

Trước khi bấm duyệt, quản trị viên mở ví của nhà phát hành đó và thấy số dư đến từ đâu: bao nhiêu
kiếm được từ bán hàng thật, bao nhiêu do quản trị viên cộng tay, bao nhiêu do nạp tiền. Con số đó
quyết định họ có duyệt hay không.

**Why this priority**: cùng mức P1 với US1 và **không phải việc làm sau**. Duyệt mà không biết
nguồn gốc tiền là chi tiền thật cho một nghĩa vụ có thể chưa từng có tiền thật đi vào — đúng tình
trạng của production hôm nay. Hai story này đi cùng nhau mới thành một quy trình an toàn.

**Independent Test**: mở ví của một nhà phát hành có cả tiền bán hàng lẫn tiền quản trị viên cộng,
kiểm phần tách nguồn gốc cộng lại đúng bằng số dư hiện tại.

**Acceptance Scenarios**:

1. **Given** một nhà phát hành có số dư gồm tiền bán hàng và tiền quản trị viên cộng,
   **When** quản trị viên xem ví của người đó,
   **Then** thấy số dư hiện tại, lịch sử các lần biến động, và **phần tách theo nguồn**: tổng từ
   bán hàng, tổng từ quản trị viên cộng, tổng từ nạp tiền.

2. **Given** một người dùng chưa từng có biến động nào,
   **When** quản trị viên xem ví của người đó,
   **Then** thấy số dư 0 và các con số nguồn đều 0 — không phải lỗi.

3. **Given** quản trị viên xem sổ cái toàn hệ thống,
   **When** họ lọc theo một người dùng, một loại biến động, hoặc một khoảng thời gian,
   **Then** chỉ thấy đúng những dòng khớp bộ lọc.

---

### User Story 3 — Quản trị viên từ chối một đơn và tiền quay về ví (Priority: P2)

Quản trị viên phát hiện thông tin ngân hàng sai, hoặc quyết định không chi. Họ từ chối kèm lý do,
và tiền quay lại ví nhà phát hành ngay.

**Why this priority**: không có nó thì một đơn sai chỉ còn cách để treo mãi, và tiền của nhà phát
hành kẹt. Nhưng nó ít gặp hơn đường duyệt-và-chi nên xếp sau.

**Independent Test**: tạo đơn, từ chối kèm lý do, kiểm số dư trở về mức trước khi tạo đơn và sổ
cái có đủ hai biến động ngược chiều nhau gắn cùng một đơn.

**Acceptance Scenarios**:

1. **Given** một đơn rút 200.000đ đang chờ duyệt và số dư nhà phát hành là 300.000đ,
   **When** quản trị viên từ chối kèm lý do,
   **Then** đơn chuyển sang trạng thái bị từ chối, lý do được lưu, số dư trở lại 500.000đ, và sổ
   cái có thêm **một** biến động hoàn tiền ghi rõ **ai từ chối và vì sao**.

2. **Given** một đơn **đã được duyệt** nhưng chưa chi,
   **When** quản trị viên từ chối,
   **Then** vẫn từ chối được và vẫn hoàn tiền — tiền chưa thật sự đi khỏi ngân hàng công ty.

3. **Given** một đơn **đã chi tiền**,
   **When** quản trị viên từ chối,
   **Then** hệ thống từ chối thao tác — tiền đã ra khỏi ngân hàng, đảo ngược trong hệ thống sẽ
   tạo ra một khoản không có thật.

4. **Given** quản trị viên từ chối mà **không nhập lý do**,
   **Then** hệ thống từ chối thao tác.

5. **Given** một đơn đã bị từ chối,
   **When** quản trị viên từ chối lần nữa,
   **Then** hệ thống từ chối và **số dư không được cộng thêm lần thứ hai**.

---

### User Story 4 — Quản trị viên kiểm tra sổ sách có cân không (Priority: P3)

Quản trị viên mở một trang và thấy ngay: tiền mặt thật đã vào bao nhiêu, tiền tự phát hành bao
nhiêu, hệ thống đang nợ người dùng bao nhiêu, bao nhiêu đang chờ chi, và **sổ có cân không**.

**Why this priority**: biến sáu phép đối soát từ truy vấn SQL trong tài liệu vận hành thành một
màn hình. Hiện tại muốn biết sổ có cân thì phải có người nhớ chạy truy vấn — và chính vì có người
chạy nên ngày 2026-11-27 mới phát hiện một ví lệch 1.000.000đ. Quan trọng, nhưng hệ thống vẫn
chạy được nếu chưa có.

**Independent Test**: mở trang đối soát, đối chiếu từng con số với kết quả chạy tay các truy vấn
trong tài liệu vận hành — phải khớp tuyệt đối.

**Acceptance Scenarios**:

1. **Given** sổ sách đang cân,
   **When** quản trị viên mở trang đối soát,
   **Then** thấy đẳng thức dòng tiền cân, và năm phép kiểm đều báo không có bất thường.

2. **Given** một ví có số dư không khớp lịch sử của nó,
   **When** quản trị viên mở trang đối soát,
   **Then** phép kiểm tương ứng báo bất thường và **chỉ đích danh ví nào**.

3. **Given** có đơn rút tiền đang chờ chi,
   **When** quản trị viên mở trang đối soát,
   **Then** số tiền đó hiện ra ở mục "đang chờ chi" — **vẫn là khoản hệ thống đang nợ**, không
   phải khoản đã chi đi.

---

### Edge Cases

- **Hai quản trị viên duyệt cùng một đơn cùng lúc**: đúng một người thành công, người kia nhận câu
  trả lời nghiệp vụ, không phải lỗi hệ thống.
- **Một người duyệt trong khi người kia từ chối, cùng lúc**: đúng một thao tác thành công; nếu từ
  chối thắng thì hoàn tiền đúng một lần.
- **Hai lệnh từ chối cùng lúc**: đúng một lần hoàn tiền, không bao giờ hai.
- **Quản trị viên duyệt trong khi nhà phát hành đang tự huỷ**: đúng một bên thành công. Nếu duyệt
  thắng thì lệnh huỷ bị từ chối (đơn không còn chờ duyệt) và tiền **không** được hoàn.
- **Từ chối một đơn mà nhà phát hành đã tự huỷ**: bị từ chối, không hoàn tiền lần hai.
- **Hồ sơ nhà phát hành bị xoá mềm sau khi tạo đơn**: từ chối sẽ không có ví nào để hoàn vào — hệ
  thống phải báo rõ ràng chứ không âm thầm bỏ qua việc hoàn tiền.
- **Lý do từ chối chỉ gồm khoảng trắng**: bị từ chối như khi bỏ trống.
- **Mã giao dịch ngân hàng chỉ gồm khoảng trắng**: bị từ chối như khi bỏ trống.
- **Lọc sổ cái theo khoảng thời gian có ngày bắt đầu sau ngày kết thúc**: bị từ chối.
- **Xem ví của một mã người dùng không tồn tại**: báo không tìm thấy.
- **Người dùng thường hoặc nhà phát hành gọi bất kỳ route nào trong spec này**: bị từ chối.
- **Trang đối soát khi hệ thống chưa có đơn rút tiền nào**: hai mục mới đều bằng 0 và đẳng thức
  quy về đúng dạng trước khi có tính năng rút tiền.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Ai được dùng

- **FR-001**: Mọi chức năng trong spec này PHẢI chỉ dành cho **quản trị viên**. Người dùng thường
  và nhà phát hành PHẢI bị từ chối ở tất cả các đường.
- **FR-002**: Các chức năng này PHẢI đi qua cơ chế **gác quyền theo vai trò** của hệ thống, khác
  với các route của nhà phát hành vốn tự lọc theo danh tính người gọi. Lý do: chúng đọc và sửa dữ
  liệu của **người khác**, nên không có "danh tính người gọi" nào để lọc.
- **FR-003**: Danh tính quản trị viên thực hiện thao tác PHẢI luôn lấy từ phiên đăng nhập, không
  bao giờ từ dữ liệu người gọi gửi lên.

#### Xem danh sách đơn

- **FR-004**: Quản trị viên PHẢI xem được danh sách đơn rút tiền của **toàn hệ thống**, có phân trang.
- **FR-005**: Danh sách PHẢI lọc được theo trạng thái đơn. Khi **không lọc**, danh sách PHẢI trả về
  **mọi trạng thái** — kể cả đơn nhà phát hành đã tự huỷ và đơn đã bị từ chối. Màn hình hàng đợi
  công việc tự lọc lấy trạng thái nó cần; dữ liệu trả về không được tự ý thu hẹp.
- **FR-006**: Mỗi đơn trong danh sách PHẢI kèm: số tiền, trạng thái, đủ ba trường thông tin ngân
  hàng, thời điểm tạo, thời điểm xử lý nếu đã xử lý, và **danh tính nhà phát hành dưới dạng người
  đọc được** — tối thiểu là tên hiển thị và email, không chỉ một mã định danh. Quản trị viên phải
  nhận ra họ đang chi tiền cho ai mà không cần tra cứu thêm.
- **FR-007**: Danh sách PHẢI sắp xếp theo thứ tự **ổn định toàn phần** — mới nhất trước, và khi
  trùng mốc thời gian thì phải có tiêu chí phụ để thứ tự không đổi giữa hai lần gọi. Không có nó,
  lật trang sẽ làm trùng hoặc sót dòng.
- **FR-007a**: Hai danh sách của spec này PHẢI có **trần số dòng mỗi trang**, và yêu cầu vượt trần
  PHẢI bị từ chối chứ không âm thầm cắt bớt.

#### Duyệt đơn

- **FR-008**: Quản trị viên PHẢI duyệt được một đơn **đang chờ duyệt**, chuyển nó sang trạng thái
  đã duyệt.
- **FR-009**: Đơn **không** ở trạng thái chờ duyệt PHẢI không duyệt được.
- **FR-010**: Việc duyệt PHẢI ghi lại **ai duyệt** và **lúc nào**.
- **FR-011**: Việc duyệt PHẢI **không làm đổi số dư** của bất kỳ ai, và PHẢI **không sinh bút toán
  sổ cái nào**. Tiền đã rời ví nhà phát hành từ lúc tạo đơn.
- **FR-012**: Hai lệnh duyệt cùng một đơn chạy song song PHẢI chỉ có một thành công, và lệnh còn
  lại nhận câu trả lời nghiệp vụ chứ không phải lỗi hệ thống.

#### Đánh dấu đã chi

- **FR-013**: Quản trị viên PHẢI đánh dấu được một đơn **đã duyệt** là đã chi tiền.
- **FR-014**: Đơn chưa duyệt PHẢI không đánh dấu chi được — thứ tự duyệt rồi mới chi là bắt buộc.
- **FR-015**: Việc đánh dấu đã chi PHẢI đòi **mã giao dịch ngân hàng**; bỏ trống hoặc chỉ có
  khoảng trắng PHẢI bị từ chối.
- **FR-016**: Việc đánh dấu đã chi PHẢI **không làm đổi số dư** và PHẢI **không sinh bút toán nào**.
- **FR-017**: Việc đánh dấu đã chi PHẢI ghi lại ai thực hiện và lúc nào.

#### Từ chối đơn

- **FR-018**: Quản trị viên PHẢI từ chối được đơn ở trạng thái **chờ duyệt** hoặc **đã duyệt**.
- **FR-019**: Đơn **đã chi tiền** PHẢI không từ chối được. Tiền đã ra khỏi ngân hàng công ty; đảo
  ngược trong hệ thống sẽ tạo ra một khoản tiền không có thật.
- **FR-020**: Đơn đã huỷ hoặc đã bị từ chối PHẢI không từ chối được lần nữa.
- **FR-021**: Việc từ chối PHẢI đòi **lý do**; bỏ trống hoặc chỉ có khoảng trắng PHẢI bị từ chối.
- **FR-022**: Việc từ chối PHẢI **hoàn đúng** số tiền của đơn về ví nhà phát hành.
- **FR-023**: Việc từ chối PHẢI để lại **đúng một** biến động hoàn tiền trên ví nhà phát hành, và
  biến động đó PHẢI ghi rõ **ai từ chối** và **lý do**.
- **FR-024**: Một đơn PHẢI không bao giờ được hoàn tiền quá một lần, kể cả khi có nhiều lệnh từ
  chối chạy song song, hoặc một lệnh từ chối chạy song song với một lệnh nhà phát hành tự huỷ.
- **FR-025**: Việc đổi trạng thái và việc hoàn tiền PHẢI cùng thành công hoặc cùng không.
- **FR-026**: Nếu hồ sơ nhà phát hành không còn để hoàn tiền vào, hệ thống PHẢI báo lỗi rõ ràng
  chứ KHÔNG được đổi trạng thái đơn mà bỏ qua việc hoàn tiền.

#### Xem sổ cái

- **FR-027**: Quản trị viên PHẢI xem được sổ cái của **toàn hệ thống**, có phân trang và **thứ tự
  ổn định toàn phần** — cùng yêu cầu với FR-007, vì sổ cái cũng lật trang được.
- **FR-028**: Sổ cái PHẢI lọc được theo **người dùng**, theo **loại biến động**, và theo **khoảng
  thời gian**.
- **FR-029**: Khoảng thời gian có ngày bắt đầu sau ngày kết thúc PHẢI bị từ chối.
- **FR-030**: Quản trị viên PHẢI xem được ví của **một người dùng cụ thể**: số dư hiện tại, lịch
  sử biến động, và **phần tách theo từng loại biến động** — cả chiều vào lẫn chiều ra:
  - vào: tổng từ bán hàng, tổng từ quản trị viên cộng, tổng từ nạp tiền
  - ra: tổng đã mua hàng, tổng đã rút, trừ đi tổng đã hoàn lại
- **FR-030a**: Các con số ở FR-030 PHẢI cộng trừ ra **đúng bằng** số dư hiện tại của ví. Chỉ liệt
  kê chiều vào là không kiểm chứng được, và một bảng không tự cân được thì không dùng để quyết
  định chi tiền.
- **FR-031**: Người dùng chưa từng có biến động nào PHẢI trả về số dư 0 và các con số nguồn bằng 0,
  KHÔNG phải một lỗi.
- **FR-032**: Mã người dùng không tồn tại PHẢI báo không tìm thấy.

#### Đối soát

- **FR-033**: Quản trị viên PHẢI xem được một bảng đối soát gồm: tiền mặt thật đã vào, tiền tự
  phát hành, tiền đã chi thật, tổng nợ với người dùng, số dư tài khoản sàn, và **tiền đang chờ chi**.
- **FR-033a**: Hai mục tiền rút PHẢI được tính theo **trạng thái của đơn**, không theo sổ cái:
  - **tiền đang chờ chi** = tổng các đơn ở trạng thái **chờ duyệt** và **đã duyệt**. Đây vẫn là
    khoản hệ thống đang nợ — tiền đã rời ví nhà phát hành nhưng còn nằm trong ngân hàng công ty.
  - **tiền đã chi thật** = tổng các đơn ở trạng thái **đã chi**. Đây mới là tiền đã rời hệ thống.
  - Đơn **đã huỷ** và đơn **bị từ chối** không nằm trong cả hai, vì tiền đã được hoàn về ví.
- **FR-034**: Bảng đối soát PHẢI cho biết **đẳng thức dòng tiền có cân không**, dùng dạng **hai
  túi**: tiền đang chờ chi là khoản hệ thống **vẫn đang nợ**, khác với tiền đã chi thật.
- **FR-035**: Bảng đối soát PHẢI chạy đủ **năm phép kiểm bất thường** mà tài liệu vận hành đang
  mô tả, và với mỗi phép báo rõ có bất thường hay không.
- **FR-036**: Khi một phép kiểm phát hiện bất thường, bảng PHẢI **chỉ đích danh** bản ghi gây ra
  nó, không chỉ nói "có lỗi".
- **FR-037**: Số liệu trên bảng đối soát PHẢI khớp tuyệt đối với kết quả chạy tay các truy vấn
  tương ứng trong tài liệu vận hành.

#### An toàn khi chạy song song

- **FR-038**: Mọi lần đổi trạng thái đơn PHẢI chống được thao tác song song: trong mọi cặp lệnh
  chạy cùng lúc, đúng một lệnh thành công.
- **FR-039**: Không tình huống nghiệp vụ nào — sai trạng thái, thiếu lý do, thiếu mã giao dịch,
  đơn không tồn tại — được phép trở thành lỗi hệ thống.

---

### Key Entities

- **Đơn rút tiền (đã có từ spec 012)**: spec này **không thêm trường nào**. Toàn bộ trạng thái và
  các ô chứa lý do từ chối, mã giao dịch, người xử lý, thời điểm xử lý đã được khai sẵn.

- **Biến động sổ cái (đã có)**: spec này thêm **một đường ghi mới** — khoản hoàn tiền do quản trị
  viên từ chối, dùng lại đúng loại biến động mà đường nhà phát hành tự huỷ đang dùng, nhưng kèm
  người thực hiện và lý do.

- **Ví người dùng (đã có)**: spec này chỉ **đọc**, trừ đường hoàn tiền khi từ chối.

---

## Success Criteria *(mandatory)*

- **SC-001**: Quản trị viên đưa được một đơn rút tiền đi trọn đường từ lúc chờ duyệt tới lúc đã
  chi bằng **hai thao tác**, và nhìn thấy trạng thái cập nhật ngay sau mỗi thao tác.
- **SC-002**: Số dư nhà phát hành **không đổi một đồng nào** qua cả hai bước duyệt và đánh dấu đã
  chi — chứng minh được bằng cách so số dư trước và sau.
- **SC-003**: Tổng số tiền của các đơn **chưa được hoàn** — tức mọi đơn trừ đơn đã huỷ và đơn bị
  từ chối — luôn **bằng đúng** hiệu giữa tổng đã trừ và tổng đã hoàn trong sổ cái, ở mọi thời điểm.
- **SC-004**: Trong thử nghiệm gửi song song, **đúng một** thao tác thành công ở ba tình huống
  loại trừ nhau: hai lệnh duyệt, hai lệnh từ chối, và duyệt chọi nhà phát hành tự huỷ.
- **SC-004a**: Duyệt chọi từ chối là trường hợp riêng — hai thao tác này **không loại trừ nhau**,
  vì từ chối nhận cả đơn đã duyệt (FR-018), nên cả hai có thể cùng thành công theo thứ tự. Bất
  biến phải giữ ở đây là: trạng thái cuối cùng mạch lạc, và **đúng một** lần hoàn tiền.
- **SC-005**: Không đơn nào bị hoàn tiền hai lần trong bất kỳ kịch bản nào, kể cả chạy song song.
- **SC-006**: Mọi tình huống bị từ chối vì lý do nghiệp vụ đều trả lỗi nghiệp vụ rõ ràng — **không
  có trường hợp nào** rơi thành lỗi hệ thống.
- **SC-007**: Người dùng thường và nhà phát hành bị từ chối ở **100%** số lần thử trên **mọi** route.
- **SC-008**: Bảng phân tách của một ví **tự cân**: tổng các khoản vào trừ tổng các khoản ra luôn
  bằng đúng số dư hiện tại, kiểm được trên mọi ví của production mà không cần biết cách hiện thực.
- **SC-009**: Mọi con số trên bảng đối soát **khớp tuyệt đối** với kết quả chạy tay truy vấn tương
  ứng trong tài liệu vận hành, kiểm trên chính dữ liệu production.
- **SC-010**: Khi cố tình làm một ví lệch, bảng đối soát phát hiện ra và **nêu đích danh ví đó**.

---

## Assumptions

- **Chi tiền là thao tác tay ngoài hệ thống.** Quản trị viên tự chuyển khoản từ tài khoản ngân
  hàng công ty rồi quay lại nhập mã giao dịch. Hệ thống không gọi API chuyển tiền nào.
- **Tài khoản sàn không liên quan tới việc chi trả.** Nó chỉ ghi nhận doanh thu hoa hồng. Rút tiền
  trừ thẳng ví nhà phát hành, nên số dư tài khoản sàn **không** hiện trên màn hình duyệt — con số
  đó không nói lên điều gì về việc có nên duyệt hay không.
- **Không có hạn mức hay quy trình phê duyệt nhiều cấp.** Một quản trị viên duyệt là đủ.
- **Không có thông báo** gửi cho nhà phát hành khi đơn đổi trạng thái.
- **Chỉ lưu người xử lý gần nhất.** Nếu một đơn được duyệt rồi sau đó bị từ chối, ô "người xử lý"
  mang tên người từ chối, và **danh tính người duyệt trước đó không còn tra được từ đơn**. Chấp
  nhận ở phase này: người từ chối vẫn được ghi lại trong biến động sổ cái của khoản hoàn tiền, nên
  thao tác động tới tiền luôn có dấu vết. Việc duyệt không động tới tiền nên mất dấu ít thiệt hại
  hơn. Muốn đủ lịch sử thì cần một bảng nhật ký riêng — ngoài phạm vi.
- **Trang đối soát đọc trực tiếp, không cache.** Quy mô hiện tại rất nhỏ (vài chục bản ghi), và
  một con số đối soát cũ còn tệ hơn là không có.
- **Lần triển khai này bắt buộc chạy seed phân quyền**, khác với spec 012. Đã kiểm ngày 2026-11-27:
  không còn khoản cấp quyền nào của vai trò không phải quản trị viên đang bị mất mà thiếu bản thay
  thế, nên thao tác đó hiện an toàn.

---

## Out of Scope

- **Gọi API chuyển tiền tự động** — đã chốt là chuyển khoản tay.
- **Thông báo / email** khi đơn đổi trạng thái.
- **Nhật ký đầy đủ cho từng lần đổi trạng thái** (xem Assumptions).
- **Quản trị viên sửa thông tin ngân hàng trên đơn** — nếu sai thì từ chối, nhà phát hành tạo đơn mới.
- **Hạn mức chi, phê duyệt nhiều cấp, phân quyền quản trị viên theo mức tiền.**
- **Quản trị viên trừ tiền trực tiếp khỏi ví người dùng** — vẫn ngoài phạm vi như spec 011.
- **Xuất báo cáo ra tệp**, biểu đồ, hay so sánh theo kỳ.
- **Tự động cảnh báo khi đối soát phát hiện lệch** — spec này chỉ hiện ra khi có người mở xem.
- **Ngăn quản trị viên sửa số dư bằng công cụ dữ liệu.** Đường ghi thứ tư đó vẫn mở; ngày
  2026-11-27 lại phát hiện thêm một ví bị đặt tay 1.000.000đ. Sổ cái chỉ **phát hiện** được, không
  ngăn được.
- **Giữ tiền trong thời gian bảo hành (escrow)** — spec riêng, và nay là việc đáng làm tiếp theo:
  từ khi spec 012 lên production, nhà phát hành rút được tiền của đơn hàng còn trong hạn bảo hành.

---

## Dependencies

- **Spec 012** — bảng đơn rút tiền, đủ 5 trạng thái và các ô chứa dữ liệu xử lý. Đã lên production.
- **Spec 011** — sổ cái và tài khoản tiền của sàn, cùng các phép đối soát mà FR-035 dựa vào.
- **Cơ chế gác quyền theo vai trò** — đã có; công cụ sinh quyền tự quét mã nguồn nên không phải
  khai tay, nhưng lần triển khai này phải chạy nó.
