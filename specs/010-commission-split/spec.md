# Feature Specification: Chia tiền bán hàng giữa sàn và nhà phát hành

**Feature Branch**: `feat/commission-split`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "Chia hoa hồng khi bán hàng — phase 2 của module payout. Khi khách mua
sản phẩm, số tiền khách trả được chia hai. Sàn giữ lại phần hoa hồng theo tỉ lệ đang cấu hình,
phần còn lại cộng ngay vào ví của publisher sở hữu sản phẩm, trong cùng giao dịch với lúc trừ tiền
khách."

**Nguồn thiết kế**: `a2matex-docs/components/a2matex-backend/commerce_entitlement_execution/payout.md`
— mục 3 (Delivery phases, hàng Phase 2), 4.2, 5 (phần Phase 2), 6, 7, 11.2, 11.6 và 16
(Acceptance criteria, Phase 2). Khi spec và doc lệch nhau, doc là nguồn đúng về thiết kế tổng thể;
spec này là nguồn đúng về phạm vi phase 2.

**Vị trí trong lộ trình**: phase 2 trong 5 phase của module payout. Phase 1
([specs/009-system-setting](../009-system-setting/spec.md)) đã chạy trên production và cung cấp
tỉ lệ hoa hồng sửa được từ trang quản trị; phase 2 là **bên tiêu thụ đầu tiên** của giá trị đó.
Phase 3 (sổ ghi biến động số dư), phase 4 (rút tiền) và phase 5 (hoàn tiền) nằm ngoài phạm vi.

**Quy ước đặt tên**: spec này gọi mọi thứ bằng tên nghiệp vụ. Định danh kỹ thuật, hình dạng dữ
liệu và cơ chế lưu trữ nằm trong [data-model.md](./data-model.md); quyết định kỹ thuật và bằng
chứng từ mã nguồn nằm trong [research.md](./research.md).

## Hiện trạng cần khắc phục

Khách mua hàng thì bị trừ tiền trong ví và nhận được quyền dùng sản phẩm, nhưng **nhà phát hành
không nhận được đồng nào**. Toàn bộ số tiền nằm lại hệ thống mà không có bản ghi nào nói ai được
hưởng bao nhiêu. Tại thời điểm viết spec, production đã có 5 đơn hàng thật của 2 nhà phát hành,
tổng 220.000 ₫, chưa được chia.

## Clarifications

### Session 2026-11-23

- Q: Sàn giữ hoa hồng rồi phần còn lại đi đâu? → A: Vào ví của nhà phát hành, cùng loại ví mà khách
  dùng để nạp và mua. Không có ví riêng.
- Q: Tiền về ví lúc nào? → A: Ngay khi mua xong, tiêu được luôn. Không có kỳ giữ tiền, không chờ
  duyệt.
- Q: Tỉ lệ hoa hồng lấy từ đâu? → A: Từ kho cấu hình đã dựng ở phase 1, quản trị viên đổi được mà
  không phát hành lại phần mềm.
- Q: Đổi tỉ lệ thì đơn cũ có bị tính lại không? → A: Không. Mỗi đơn đóng băng tỉ lệ đã áp dụng cho
  chính nó.
- Q: Phần hoa hồng sàn giữ có vào tài khoản nào không? → A: Không, chỉ ghi nhận trên từng đơn.
  Tài khoản riêng cho sàn để sau.
- Q: Nhà phát hành mua sản phẩm của chính mình thì sao? → A: Chặn. Cho phép thì họ tự lỗ đúng phần
  hoa hồng cho thứ họ đã sở hữu. Cần dùng thử thì đi qua đường cấp quyền của quản trị viên, không
  chạy tiền.
- Q: Phần lẻ không chia hết thuộc về ai? → A: Nhà phát hành.
- Q: 5 đơn hàng đã có trên hệ thống xử lý thế nào? → A: **Đều là giao dịch thử của chủ repo**, không
  phải khách thật. Không cần chia lại, không cộng ví ai. Ghi toàn bộ về phía sàn cho cả 5 đơn.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Nhà phát hành nhận tiền khi bán được hàng (Priority: P1)

Khách mua một sản phẩm giá 100.000 ₫. Tiền trong ví khách giảm đúng 100.000 ₫. Cùng lúc đó, ví của
nhà phát hành sở hữu sản phẩm tăng đúng phần còn lại sau khi sàn giữ hoa hồng. Nhà phát hành tiêu
được số tiền đó ngay.

**Why this priority**: đây là lý do toàn bộ module payout tồn tại. Không có phần này thì nhà phát
hành bán hàng mà không bao giờ nhận được tiền.

**Independent Test**: mua một sản phẩm, kiểm số dư của cả hai bên trước và sau; tổng thay đổi của
hai ví cộng với phần sàn giữ phải đúng bằng giá bán.

**Acceptance Scenarios**:

1. **Given** khách có đủ tiền và sản phẩm đang bán, **When** khách mua, **Then** ví khách giảm đúng
   giá bán và ví nhà phát hành tăng đúng phần của họ, cả hai cùng lúc.
2. **Given** giao dịch mua thất bại ở bất kỳ bước nào, **When** kết thúc, **Then** **không** ví nào
   thay đổi và không đơn hàng nào được tạo.
3. **Given** khách không đủ tiền, **When** mua, **Then** bị từ chối và ví nhà phát hành không được
   cộng gì.
4. **Given** hệ thống không đọc được tỉ lệ hoa hồng, **When** khách mua, **Then** đơn bị từ chối và
   ví khách giữ nguyên — không được tự chọn một tỉ lệ thay thế.
5. **Given** sản phẩm miễn phí, **When** khách nhận, **Then** đơn vẫn được tạo nhưng không ví nào
   thay đổi.
6. **Given** một nhà phát hành, **When** họ mua chính sản phẩm của mình, **Then** bị từ chối và
   không ví nào thay đổi.

---

### User Story 2 - Nhà phát hành theo dõi doanh thu của mình (Priority: P2)

Nhà phát hành mở trang doanh thu, thấy từng đơn đã bán kèm giá khách trả, phần sàn giữ, phần mình
thực nhận, sản phẩm nào và ngày nào; cùng một bản tổng hợp.

**Why this priority**: tiền đã về ví dù không có màn hình này, nhưng không nhìn được thì không đối
chiếu được và không tin được.

**Independent Test**: bán vài đơn rồi mở trang doanh thu, đối chiếu từng dòng và tổng với thay đổi
thực tế của số dư.

**Acceptance Scenarios**:

1. **Given** nhà phát hành đã bán 3 đơn, **When** mở danh sách doanh thu, **Then** thấy đủ 3 dòng
   kèm giá bán, phần sàn giữ, phần thực nhận, sản phẩm và ngày.
2. **Given** bản tổng hợp, **When** đối chiếu với danh sách, **Then** tổng khớp với tổng các dòng.
3. **Given** hai nhà phát hành khác nhau, **When** một người mở trang doanh thu, **Then** chỉ thấy
   đơn của chính mình, không có cách nào xem được của người kia.

---

### User Story 3 - Lịch sử chia tiền không đổi được (Priority: P3)

Quản trị viên đổi tỉ lệ hoa hồng. Những đơn đã bán trước đó vẫn giữ nguyên con số đã chia, và vẫn
truy được đúng người đã nhận tiền kể cả khi quyền sở hữu sản phẩm sau này thay đổi.

**Why this priority**: tiền đã chạy rồi nên tính đúng đắn không phụ thuộc phần này, nhưng thiếu nó
thì mọi đối soát về sau đều không đáng tin.

**Independent Test**: bán một đơn, đổi tỉ lệ, mở lại đơn cũ và thấy con số cũ nguyên vẹn.

**Acceptance Scenarios**:

1. **Given** một đơn đã bán ở mức 30%, **When** quản trị viên đổi sang 25%, **Then** đơn cũ vẫn
   hiển thị đã chia theo 30% và các con số không đổi.
2. **Given** đơn kế tiếp sau khi đổi tỉ lệ, **When** được tạo, **Then** áp mức 25%.
3. **Given** một đơn đã bán, **When** quyền sở hữu sản phẩm chuyển sang người khác, **Then** đơn cũ
   vẫn truy ra đúng người đã thực nhận tiền.

---

### Edge Cases

- **Số tiền không chia hết** theo tỉ lệ → phần lẻ thuộc nhà phát hành, và tổng hai phần vẫn phải
  khớp tuyệt đối với giá bán. Không được xuất hiện chênh lệch dù chỉ một đơn vị.
- **Tỉ lệ 0%** → nhà phát hành nhận toàn bộ, sàn giữ 0.
- **Tỉ lệ 100%** → sàn giữ toàn bộ, ví nhà phát hành không thay đổi.
- **Giá 0** → không ví nào thay đổi, đơn vẫn được ghi nhận.
- **Hai khách mua cùng lúc từ một nhà phát hành** → cả hai thành công và số dư nhà phát hành phản
  ánh đủ cả hai lần cộng, không mất lần nào.
- **Hai nhà phát hành mua chéo sản phẩm của nhau đúng cùng thời điểm** → cả hai giao dịch phải hoàn
  tất, không được kẹt lẫn nhau.
- **Khách bấm mua hai lần do mạng chập chờn** → chỉ một đơn được tạo và nhà phát hành chỉ được cộng
  tiền một lần.
- **Nhà phát hành chưa có ví** → đơn bị từ chối, không được bán xong mà tiền rơi vào hư không.
- **Đơn hàng đã tồn tại trước khi có tính năng này** → vẫn phải đọc được và có đủ thông tin chia
  tiền. Xem Assumptions.
- **Đơn cũ mà người mua chính là nhà phát hành** → tình huống này **đã có thật** trong dữ liệu
  hiện tại. Từ nay bị chặn, nhưng các đơn cũ vẫn còn đó và không được chia tiền cho người đã mua
  chính hàng của mình.

## Requirements *(mandatory)*

### Functional Requirements

**Chia tiền**

- **FR-001**: Khi một đơn hàng phát sinh, hệ thống PHẢI chia số tiền khách trả thành phần sàn giữ
  và phần nhà phát hành nhận, theo tỉ lệ đang có hiệu lực.
- **FR-002**: Tổng của hai phần PHẢI bằng chính xác số tiền khách trả, với mọi mức giá và mọi tỉ
  lệ. Hệ thống PHẢI không thể lưu được một đơn hàng vi phạm điều này.
- **FR-003**: Phần không chia hết PHẢI thuộc về nhà phát hành.
- **FR-004**: Tỉ lệ hoa hồng PHẢI lấy từ kho cấu hình tại thời điểm mua. Khi không lấy được, hệ
  thống PHẢI từ chối đơn hàng thay vì dùng một giá trị thay thế.
- **FR-005**: Tỉ lệ do khách gửi lên PHẢI bị bỏ qua hoàn toàn, giống như hệ thống đang bỏ qua giá
  do khách gửi.

**Chuyển tiền**

- **FR-006**: Việc trừ ví khách, cộng ví nhà phát hành, ghi nhận đơn hàng và cấp quyền dùng sản
  phẩm PHẢI cùng thành công hoặc cùng không xảy ra. Không được tồn tại trạng thái tiền đã chuyển mà
  không có đơn hàng, hoặc ngược lại.
- **FR-007**: Tiền của nhà phát hành PHẢI dùng được ngay sau khi giao dịch hoàn tất, không có kỳ
  chờ.
- **FR-008**: Hai giao dịch mua diễn ra đồng thời và cùng đụng tới một cặp ví PHẢI không bao giờ
  kẹt lẫn nhau.
- **FR-009**: Một lần mua bị lặp lại PHẢI chỉ cộng tiền cho nhà phát hành đúng một lần.
- **FR-010**: Khi nhà phát hành không có ví để nhận tiền, hệ thống PHẢI từ chối đơn hàng và ghi lại
  sự cố.
- **FR-011**: Giao dịch mua có số tiền bằng 0 PHẢI không làm thay đổi ví nào.

**Chặn tự mua**

- **FR-012**: Nhà phát hành PHẢI không mua được sản phẩm của chính mình, và lần từ chối đó không
  làm thay đổi ví nào.
- **FR-012b**: FR-012 là điều bảo đảm rằng mỗi giao dịch mua luôn đụng tới **hai ví khác nhau**.
  Yêu cầu về giao dịch đồng thời ở FR-008 dựa trên điều này; bỏ FR-012 thì phải xử lý riêng trường
  hợp hai ví trùng nhau.

**Bằng chứng không đổi được**

- **FR-013**: Mỗi đơn hàng PHẢI lưu lại tỉ lệ đã áp dụng, phần sàn giữ, phần nhà phát hành nhận, và
  người đã thực nhận tiền.
- **FR-014**: Thay đổi tỉ lệ về sau PHẢI không làm thay đổi bất kỳ con số nào của đơn đã tạo.
- **FR-015**: Đơn hàng PHẢI truy ra đúng người đã nhận tiền kể cả khi quyền sở hữu sản phẩm thay
  đổi về sau.
- **FR-016**: Mọi đơn hàng đã tồn tại trước tính năng này PHẢI có đủ thông tin chia tiền sau khi
  triển khai.
- **FR-016b**: Đơn cũ mà người mua chính là nhà phát hành PHẢI không được chia tiền cho họ, bất kể
  cách xử lý chung với các đơn cũ khác là gì. Tiền chưa bao giờ rời tay họ nên không có gì để
  trả lại.

**Xem doanh thu**

- **FR-017**: Nhà phát hành PHẢI xem được danh sách đơn đã bán của mình, mỗi dòng gồm số tiền khách
  trả, phần sàn giữ, phần mình thực nhận, sản phẩm và thời điểm.
- **FR-018**: Nhà phát hành PHẢI xem được bản tổng hợp doanh thu, và bản này PHẢI khớp với tổng các
  dòng trong danh sách.
- **FR-019**: Nhà phát hành PHẢI chỉ xem được doanh thu của chính mình, không có tham số nào cho
  phép xem của người khác.
- **FR-020**: Doanh thu hoa hồng của sàn PHẢI tính được từ dữ liệu đơn hàng.
- **FR-021**: Mọi chức năng xem doanh thu PHẢI yêu cầu đăng nhập và có bản ghi phân quyền tương
  ứng, tạo ra trong cùng lần thay đổi.
- **FR-022**: Sau khi phân quyền cho chức năng mới, người dùng hợp lệ PHẢI dùng được ngay, không bị
  từ chối vì hệ thống còn dùng lại dữ liệu phân quyền cũ.

### Key Entities

- **Phần chia của một đơn hàng**: bốn thông tin gắn chết vào mỗi đơn — tỉ lệ đã áp dụng, số tiền
  sàn giữ, số tiền nhà phát hành nhận, và người thực nhận. Được ghi một lần lúc mua và không có
  đường sửa, giống như các điều khoản thương mại mà đơn hàng đang đóng băng sẵn.
- **Ví**: nơi giữ số dư của một người. Cùng một loại ví cho khách và nhà phát hành — người bán hàng
  xong có thể dùng tiền đó để mua hàng của người khác.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Sau mỗi lần bán, số dư nhà phát hành tăng đúng bằng phần của họ, sai lệch bằng 0.
- **SC-002**: Không tồn tại đơn hàng nào có tổng hai phần khác với số tiền khách trả, kể cả khi ghi
  dữ liệu trực tiếp không qua ứng dụng.
- **SC-003**: Nhà phát hành dùng được tiền vừa nhận ngay trong lần thao tác kế tiếp.
- **SC-004**: 100% giao dịch mua thất bại không để lại thay đổi nào trên ví của cả hai bên.
- **SC-005**: Hai giao dịch mua đồng thời đụng cùng một cặp ví đều hoàn tất, tỉ lệ kẹt lẫn nhau
  bằng 0.
- **SC-006**: Một lần mua bị lặp lại không bao giờ làm nhà phát hành được cộng tiền hai lần.
- **SC-007**: Đổi tỉ lệ hoa hồng không làm thay đổi con số của bất kỳ đơn nào đã tạo.
- **SC-008**: Bản tổng hợp doanh thu khớp 100% với tổng các dòng tương ứng.
- **SC-009**: Doanh thu hoa hồng của sàn trong một khoảng thời gian tính ra được từ dữ liệu đơn
  hàng, không cần nguồn nào khác.
- **SC-010**: Không nhà phát hành nào xem được doanh thu của người khác.

## Assumptions

- Tỉ lệ hoa hồng hiện hành là 30%, do quản trị viên đặt ở phase 1 và đổi được bất cứ lúc nào mà
  không phát hành lại phần mềm.
- Phần hoa hồng sàn giữ không được cộng vào tài khoản nào. Doanh thu sàn là con số tính ra từ đơn
  hàng. Tài khoản riêng cho sàn thuộc phần mở rộng sau.
- Mỗi sản phẩm thuộc về đúng một nhà phát hành. Chia tiền cho nhiều người trên cùng một sản phẩm
  nằm ngoài phạm vi.
- Nhà phát hành luôn có ví, vì ví được tạo cùng tài khoản. Trường hợp không có bị coi là lỗi hệ
  thống chứ không phải trạng thái hợp lệ.
- Số lượng đơn hàng ở quy mô hiện tại đủ nhỏ để tính tổng doanh thu trực tiếp, chưa cần bảng tổng
  hợp sẵn.
- **Đã chốt — 5 đơn hàng đã có trên hệ thống đều là giao dịch thử.** Chủ repo xác nhận ngày
  2026-11-23. Cả 5 đơn được ghi toàn bộ về phía sàn, phần nhà phát hành bằng 0, và **không cộng ví
  ai**. Không cần phân biệt đơn tự mua với đơn còn lại nữa vì cách xử lý giống hệt nhau — FR-016b
  vẫn giữ để nếu sau này có môi trường khác với đơn thật thì luật đó vẫn chặn đúng chỗ.

## Out of Scope

- Sổ ghi mọi biến động số dư — phase 3.
- Rút tiền về ngân hàng — phase 4.
- Hoàn tiền và thu hồi phần đã chia — phase 5.
- Tài khoản ví riêng cho sàn.
- Tỉ lệ hoa hồng riêng theo nhà phát hành hoặc theo sản phẩm.
- Kỳ giữ tiền, hạn mức, kiểm soát rủi ro.
- Thuế, hoá đơn, nhiều loại tiền tệ.
- Chia doanh thu cho nhiều người trên cùng một sản phẩm.
