# Feature Specification: Order — customer mua quyền dùng Product bằng số dư

**Feature Branch**: `007-order`

**Created**: 2026-11-21

**Status**: Draft

**Input**: User description: "Viết spec cho tính năng Order: customer mua gói của Product bằng số dư
ví, kể cả gói giá 0; lưu bản sao điều khoản thương mại tại thời điểm mua; chặn mua khi quyền còn
hiệu lực hoặc đang bị thu hồi; gói một lần chỉ được nhận một lần cho mỗi Product; chống bấm mua hai
lần; tạo hoặc kích hoạt lại quyền dùng cùng lúc với việc trừ tiền. Đối chiếu codebase và tính năng
Entitlement vừa làm để spec chính xác và nhất quán."

**Related spec**: [`006-entitlement`](../006-entitlement/spec.md) — mua hàng là cách duy nhất để
customer tự có quyền dùng. Việc trừ tiền và việc có quyền phải thành công hoặc thất bại cùng nhau;
mọi quy tắc chặn mua đều dựa trên trạng thái quyền mà spec 006 định nghĩa.

**Planning input**: [`planning-notes.md`](./planning-notes.md) — các quyết định kỹ thuật và những
điểm đã đối chiếu với codebase (thứ tự khoá, mã lỗi, route, migration), dùng làm đầu vào cho
`/speckit-plan`.

## Clarifications

### Session 2026-11-21

- Q: Customer trả tiền bằng gì? → A: Chỉ bằng số dư ví có sẵn trong hồ sơ của customer. Mua là trừ
  thẳng số dư trong cùng một giao dịch; không có bước thanh toán qua cổng, không có đối soát sau.
  Nạp tiền là tính năng riêng đã có, chạy trước khi mua.
- Q: Có cần chống bấm mua hai lần không? → A: Có. Mỗi lần bấm mua, client gửi kèm một mã chống trùng
  do client sinh ra; gửi lại cùng mã thì nhận lại đúng đơn cũ, không bị trừ tiền lần hai. Dùng lại
  đúng cách làm đã có ở tính năng gửi Submission.
- Q: Customer đang bị thu hồi quyền có mua lại được không? → A: Không. Quyền bị thu hồi chặn mọi lần
  mua mới với Product đó; chỉ Admin cấp quyền lại mới gỡ được (quyết định đã chốt ở spec 006).
- Q: Customer đang còn quyền hiệu lực (còn hạn hoặc vĩnh viễn) bấm mua tiếp thì sao? → A: Chặn hoàn
  toàn, dù quyền đến từ lần mua trước hay từ Admin cấp. Không gia hạn, không cộng dồn, không đổi
  gói, không quy đổi phần còn lại. Customer chỉ mua lại được sau khi quyền hết hạn. Lý do: giữ đúng
  mô hình "mỗi customer một quyền duy nhất cho mỗi Product, kỳ mới luôn bắt đầu từ thời điểm mua"
  của spec 006; mọi phương án gia hạn đều kéo theo cộng dồn kỳ và phải sửa lại spec 006.
- Q: Ghi nhận doanh thu và chia tiền cho Publisher? → A: Ngoài phạm vi, để spec sau. Spec này chỉ
  trừ tiền của customer.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Mua gói thuê bao bằng số dư (Priority: P1)

Customer đã nạp tiền, mở trang Product trên marketplace, chọn một gói thuê bao (ví dụ 30 ngày) và
bấm mua. Số dư bị trừ đúng giá đang niêm yết, Product xuất hiện ngay trong danh sách Product của
customer với hạn dùng đúng bằng thời lượng gói.

**Why this priority**: đây là luồng doanh thu chính. Một Product chỉ được phép bán khi còn ít nhất
một gói thuê bao, nên mọi Product bán được đều đi qua luồng này.

**Independent Test**: customer có số dư 100.000, mua gói thuê bao 30 ngày giá 50.000 → số dư còn
50.000, có một đơn hàng đã thanh toán ghi đúng giá và điều khoản, quyền dùng có hiệu lực và hết hạn
sau 30 ngày.

**Acceptance Scenarios**:

1. **Given** Product đang bán, gói thuê bao hợp lệ, số dư đủ, customer chưa có quyền với Product,
   **When** customer mua, **Then** số dư giảm đúng giá; một đơn hàng đã thanh toán được tạo kèm bản
   sao điều khoản (loại gói, giá, thời lượng); quyền dùng được tạo với kỳ bắt đầu từ thời điểm mua
   và hết hạn sau đúng thời lượng gói.
2. **Given** số dư nhỏ hơn giá gói, **When** customer mua, **Then** yêu cầu bị từ chối vì không đủ
   số dư; không có đơn hàng nào được tạo, số dư và quyền không đổi.
3. **Given** customer đang có quyền còn hiệu lực với Product (từ lần mua trước hoặc do Admin cấp),
   **When** customer mua bất kỳ gói nào của Product đó, **Then** yêu cầu bị từ chối vì quyền còn
   hiệu lực; không trừ tiền, không đổi hạn.
4. **Given** quyền của customer đã hết hạn, **When** customer mua gói thuê bao, **Then** quyền đó
   được kích hoạt lại với kỳ mới tính từ thời điểm mua, không nối tiếp phần đã hết của kỳ cũ.
5. **Given** Publisher vừa đổi giá gói sau khi customer mở trang, **When** customer bấm mua,
   **Then** đơn hàng dùng giá đang có trong hệ thống tại thời điểm mua, không dùng giá client gửi
   lên hay đang hiển thị.
6. **Given** customer đang bị thu hồi quyền với Product, **When** customer mua, **Then** yêu cầu bị
   từ chối vì quyền đang bị thu hồi; lý do này được kiểm tra trước lý do "quyền còn hiệu lực".

---

### User Story 2 - Nhận gói một lần, miễn phí hoặc trả tiền (Priority: P1)

Customer dùng thử miễn phí hoặc mua một gói một lần (gói giới thiệu, khuyến mãi, hoặc gói vĩnh
viễn). Mỗi customer chỉ được nhận gói một lần **một lần duy nhất** cho mỗi Product, bất kể Publisher
tạo bao nhiêu gói một lần khác nhau.

**Why this priority**: MVP ưu tiên Product miễn phí; acquisition giá 0 đi chung đường mua hàng nên
phải đúng ngay từ bản đầu, không phải đường tắt riêng.

**Independent Test**: customer có số dư 0 nhận gói một lần giá 0 thời hạn 7 ngày → có đơn hàng tổng
tiền 0, quyền dùng 7 ngày, hệ thống ghi nhận customer đã dùng suất một lần; sau khi quyền hết hạn,
nhận một gói một lần khác của cùng Product bị từ chối.

**Acceptance Scenarios**:

1. **Given** gói một lần giá 0, **When** customer có số dư 0 nhận gói, **Then** thành công; vẫn tạo
   đơn hàng với tổng tiền 0; số dư không đổi.
2. **Given** gói một lần không có thời hạn, **When** nhận thành công, **Then** quyền dùng là vĩnh
   viễn.
3. **Given** customer đã từng nhận gói một lần của Product và quyền đã hết hạn, **When** nhận bất kỳ
   gói một lần nào của Product đó, **Then** yêu cầu bị từ chối vì suất một lần đã dùng.
4. **Given** customer đã dùng suất một lần và quyền đã hết hạn, **When** mua gói thuê bao, **Then**
   thành công.
5. **Given** customer từng mua gói thuê bao đã hết hạn nhưng chưa từng nhận gói một lần, **When**
   nhận gói một lần, **Then** thành công.
6. **Given** customer dùng suất một lần ở lần mua đầu, **When** mua thêm các lần sau, **Then** mốc
   thời điểm dùng suất một lần không bị ghi đè và không bao giờ bị xoá.

---

### User Story 3 - Bấm mua hai lần hoặc mạng chập chờn không bị trừ tiền hai lần (Priority: P1)

Customer bấm "Mua", mạng chập chờn nên client gửi lại yêu cầu, hoặc customer bấm đúp. Customer chỉ
bị trừ tiền một lần và nhận lại đúng đơn hàng đã tạo.

**Why this priority**: trừ tiền trùng là mất tiền thật của customer và là loại lỗi khó hoàn lại khi
chưa có tính năng hoàn tiền.

**Independent Test**: gửi hai yêu cầu song song với cùng một mã chống trùng → cả hai trả về cùng một
đơn hàng, số dư chỉ giảm một lần, hệ thống chỉ có một đơn hàng.

**Acceptance Scenarios**:

1. **Given** đã có đơn hàng tạo bằng mã chống trùng K, **When** gửi lại cùng mã K cho cùng gói,
   **Then** trả lại chính đơn hàng đó với cùng nội dung; không trừ tiền, không tạo đơn mới.
2. **Given** đã có đơn hàng tạo bằng mã K cho gói A, **When** gửi mã K cho gói B, **Then** yêu cầu
   bị từ chối vì mã đã dùng cho yêu cầu khác.
3. **Given** lần mua với mã K thất bại vì lý do nghiệp vụ (ví dụ thiếu số dư), **When** customer nạp
   thêm tiền rồi gửi lại đúng mã K, **Then** yêu cầu được xử lý như mới và có thể thành công — lần
   thất bại không để lại dấu vết nào.
4. **Given** hai yêu cầu đồng thời cùng mã K, **When** yêu cầu đến sau thua vì quy tắc nghiệp vụ
   (quyền vừa được yêu cầu đầu tạo ra), **Then** yêu cầu đó vẫn trả lại đơn hàng của mã K thay vì
   báo lỗi.
5. **Given** yêu cầu không kèm mã chống trùng hoặc mã sai định dạng, **When** gửi, **Then** bị từ
   chối ở bước xác thực đầu vào; không có gì thay đổi.

---

### User Story 4 - Xem lịch sử mua hàng (Priority: P2)

Customer xem danh sách đơn hàng của mình và chi tiết từng đơn, với giá và điều khoản đúng như lúc
mua, kể cả khi Publisher đã đổi giá hoặc bỏ hẳn gói đó.

**Why this priority**: cần cho hỗ trợ và tranh chấp, nhưng không chặn luồng mua, nên làm sau khi ba
story P1 chạy được.

**Independent Test**: mua gói giá 50.000, Publisher đổi giá thành 70.000 rồi bỏ gói → lịch sử vẫn
hiển thị 50.000 và thời lượng cũ.

**Acceptance Scenarios**:

1. **Given** customer có nhiều đơn hàng, **When** xem danh sách, **Then** nhận danh sách phân trang,
   mới nhất trước, mỗi dòng có trạng thái, tổng tiền, thời điểm thanh toán, Product và điều khoản đã
   mua.
2. **Given** customer mở đơn hàng của người khác, **When** xem chi tiết, **Then** nhận kết quả
   "không tìm thấy", không phân biệt được với đơn không tồn tại.
3. **Given** customer bị Admin thu hồi quyền, **When** xem lịch sử, **Then** vẫn thấy đầy đủ các đơn
   hàng cũ; thu hồi quyền không xoá lịch sử mua.

---

### Edge Cases

- Product ở trạng thái nháp, đã ngừng bán hoặc đang bị tạm khoá: chặn mua với lý do Product không
  bán được. Product đã xoá: coi như không tồn tại.
- Gói đã bị Publisher bỏ khỏi bảng giá, hoặc gói không thuộc Product đang mua: coi như không tồn
  tại.
- Publisher **đổi giá** một gói trong lúc customer đang mua: gói vẫn là gói đó (danh tính của gói là
  loại gói + thời lượng, giá không thuộc danh tính), lần mua dùng giá mới nhất đã lưu. Chỉ khi
  Publisher **bỏ hẳn** tổ hợp loại gói + thời lượng đó thì lần mua mới thất bại vì gói không còn.
- Hai lần mua khác mã chống trùng, khác gói, cùng một customer và cùng một Product, chạy đồng thời:
  chỉ một thành công; lần còn lại bị chặn vì quyền vừa có hiệu lực và không bị trừ tiền.
- Hai lần mua đồng thời của cùng customer cho hai Product khác nhau, số dư chỉ đủ cho một: đúng một
  lần thành công; số dư không bao giờ âm.
- Mua đồng thời với một lần nạp tiền: không mất cập nhật nào; số dư cuối cùng phản ánh cả hai.
- Quyền đang bị thu hồi, bất kể còn hạn hay đã hết hạn: đều bị chặn, và chặn **trước** khi hệ thống
  chạm tới bước kích hoạt lại quyền.
- Quyền vĩnh viễn do Admin cấp: luôn bị chặn vì quyền còn hiệu lực.
- Publisher mua Product của chính mình: xử lý như customer bình thường, không ưu đãi, không chặn.
- Customer chưa có hồ sơ (nơi giữ số dư): chặn mua với lý do riêng.
- Lần mua thất bại ở bất kỳ bước nào: không để lại đơn hàng, không trừ tiền, không đổi quyền.

## Requirements *(mandatory)*

### Functional Requirements

**Mua hàng**

- **FR-001**: Customer đã đăng nhập PHẢI mua được bằng cách chỉ định **gói muốn mua** và gửi kèm mã
  chống trùng. Hệ thống PHẢI tự đọc lại loại gói, giá và thời lượng từ dữ liệu hiện tại; KHÔNG nhận
  giá, thời lượng, loại gói hay Product do client gửi lên.
- **FR-002**: Một lần mua PHẢI là một thao tác toàn-hoặc-không: trừ số dư, tạo đơn hàng, lưu điều
  khoản đã mua và tạo/kích hoạt lại quyền dùng cùng thành công hoặc cùng không xảy ra.
- **FR-003**: Sau khi tra mã chống trùng mà chưa có đơn hàng nào cho mã đó (FR-022), hệ thống PHẢI
  kiểm tra theo đúng thứ tự sau và trả về lý do đầu tiên gặp phải, mỗi lý do là một trường hợp riêng
  biệt phân biệt được:
  1. Gói còn tồn tại và thuộc một Product còn tồn tại.
  2. Product đang bán.
  3. Quyền của customer với Product đó không ở trạng thái bị thu hồi.
  4. Customer không đang có quyền còn hiệu lực với Product đó.
  5. Nếu là gói một lần: customer chưa từng dùng suất một lần của Product đó.
  6. Số dư đủ trả giá gói.
- **FR-004**: Trừ số dư PHẢI nguyên tử và có điều kiện "số dư còn đủ"; số dư KHÔNG BAO GIỜ được âm,
  kể cả khi nhiều lần mua và nhiều lần nạp tiền xảy ra đồng thời.
- **FR-005**: Lần mua thành công PHẢI tạo một đơn hàng ở trạng thái đã thanh toán, ghi thời điểm
  thanh toán và tổng tiền. Lần mua thất bại KHÔNG được để lại đơn hàng ở bất kỳ trạng thái nào.
- **FR-006**: Mỗi đơn hàng PHẢI lưu một bản sao bất biến của điều khoản thương mại tại thời điểm mua
  (loại gói, giá, thời lượng) cùng tham chiếu tới Product và gói đã mua. Bản sao này KHÔNG thay đổi
  khi Publisher sửa giá hoặc bỏ gói về sau.
- **FR-007**: Gói giá 0 PHẢI đi đúng luồng mua ở trên và vẫn tạo đơn hàng với tổng tiền 0; không có
  đường tắt riêng cho acquisition miễn phí.
- **FR-008**: Trong cùng lần mua, hệ thống PHẢI tạo mới hoặc kích hoạt lại quyền dùng theo đúng
  contract của spec 006: kỳ bắt đầu từ thời điểm mua, hết hạn sau đúng thời lượng gói (hoặc vĩnh
  viễn), không cộng dồn kỳ cũ, ghi nhận nguồn là mua hàng kèm lần mua và gói tương ứng, và ghi mốc
  dùng suất một lần nếu đây là lần đầu.
- **FR-009**: Mọi so sánh thời gian và mọi mốc thời gian của một lần mua PHẢI dùng cùng một nguồn
  thời gian thống nhất của hệ thống, không phụ thuộc đồng hồ của từng máy chủ ứng dụng.
- **FR-010**: Quyền đang bị thu hồi PHẢI bị chặn **trước** khi hệ thống chạm tới bước kích hoạt
  quyền. Lớp bảo vệ dữ liệu của spec 006 không cho phép một quyền vừa có hiệu lực vừa mang thông tin
  thu hồi, nên nếu lần mua đi tới bước kích hoạt thì customer sẽ nhận một lỗi kỹ thuật thay vì lý do
  nghiệp vụ rõ ràng — đây là kết quả KHÔNG chấp nhận được.
- **FR-011**: Suất "gói một lần" tính theo cặp customer–Product, KHÔNG theo từng gói: Publisher tạo
  nhiều gói một lần khác nhau cũng chỉ cho customer đúng một suất cho Product đó. Mốc đã dùng suất
  một lần KHÔNG BAO GIỜ bị xoá, kể cả khi quyền hết hạn, bị thu hồi hay được Admin cấp lại.
- **FR-012**: Spec này KHÔNG hỗ trợ: cộng dồn kỳ, gia hạn sớm, nâng/hạ gói, quy đổi phần còn lại,
  hoàn tiền, huỷ đơn, mã giảm giá, giỏ nhiều Product và thanh toán định kỳ tự động.

**Chống trùng lặp**

- **FR-020**: Mỗi yêu cầu mua PHẢI kèm một mã chống trùng do client sinh; thiếu hoặc sai định dạng
  thì bị từ chối ở bước xác thực đầu vào, trước khi chạm vào dữ liệu.
- **FR-021**: Mã chống trùng PHẢI được lưu cùng đơn hàng và là duy nhất trong phạm vi một customer.
  Mã được giữ vĩnh viễn cùng đơn hàng, không có thời hạn hết hiệu lực.
- **FR-022**: Nếu đã có đơn hàng của cùng customer với cùng mã: cùng gói đã mua ⇒ trả lại đúng đơn
  hàng đó, không có tác dụng phụ; khác gói ⇒ từ chối vì mã đã dùng cho yêu cầu khác.
- **FR-023**: Khi một lần mua thất bại vì bất kỳ lý do nào, hệ thống PHẢI tra lại mã chống trùng một
  lần nữa; nếu lúc đó đã có đơn hàng cho mã đó (do một yêu cầu đồng thời vừa hoàn tất), PHẢI trả lại
  đơn hàng đó theo FR-022 thay vì trả lỗi.
- **FR-024**: Lần mua thất bại KHÔNG để lại bản ghi nào gắn với mã chống trùng; customer có thể gửi
  lại đúng mã đó sau khi khắc phục nguyên nhân.

**Lịch sử mua hàng**

- **FR-030**: Customer PHẢI xem được danh sách đơn hàng của chính mình, có phân trang, mới nhất
  trước.
- **FR-031**: Customer PHẢI xem được chi tiết một đơn hàng của mình. Đơn của người khác và đơn không
  tồn tại PHẢI cho cùng một kết quả "không tìm thấy", không để lộ sự tồn tại của đơn người khác.
- **FR-032**: Dữ liệu đơn hàng trả về PHẢI gồm trạng thái, tổng tiền, thời điểm thanh toán, thời
  điểm tạo, Product (kèm tên hiện tại) và bản sao điều khoản đã mua. Kết quả của lần mua thành công
  PHẢI kèm trạng thái quyền dùng ngay sau khi mua (trạng thái hiển thị, ngày bắt đầu, ngày hết hạn).
- **FR-033**: Số tiền PHẢI giữ nguyên giá trị chính xác trên toàn miền giá được phép, kể cả những
  mức giá rất lớn; không được làm tròn hay mất chữ số khi hiển thị lại cho customer.

**Dữ liệu và quyền truy cập**

- **FR-040**: Quyền dùng PHẢI tham chiếu được tới lần mua gần nhất đã tạo ra nó, và tham chiếu này
  PHẢI được ràng buộc toàn vẹn ở tầng dữ liệu. Spec 006 đã cố ý để lại tham chiếu này chưa có ràng
  buộc vì đơn hàng chưa tồn tại; spec này PHẢI bổ sung ràng buộc đó.
- **FR-041**: Chỉ chủ đơn hàng xem được đơn của mình, và chỉ vai trò customer mới mua được. Trong
  phạm vi spec này không có chức năng quản trị nào cho đơn hàng.

### Key Entities *(include if feature involves data)*

- **Đơn hàng (Order)** (mới): một lần mua bằng số dư của một customer — chủ đơn, trạng thái, tổng
  tiền, thời điểm thanh toán, mã chống trùng (duy nhất theo customer), thời điểm tạo. Không sửa sau
  khi tạo.
- **Dòng hàng (OrderItem)** (mới): phần bất biến của đơn hàng — Product đã mua, gói đã mua, đơn giá
  và bản sao điều khoản thương mại. Mỗi đơn hàng trong MVP có đúng một dòng hàng. Tham chiếu tới gói
  vẫn còn giá trị kể cả khi Publisher đã bỏ gói đó khỏi bảng giá (gói được xoá mềm).
- **Số dư ví** (đã có, trong hồ sơ customer): nguồn tiền duy nhất của tính năng này; được cộng bởi
  tính năng nạp tiền và bị trừ bởi đơn hàng.
- **Quyền dùng (Entitlement)** (spec 006): được tạo mới hoặc kích hoạt lại trong cùng lần mua, và
  trỏ về dòng hàng cùng gói của lần mua gần nhất.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 0 trường hợp customer bị trừ tiền hai lần cho cùng một mã chống trùng, kể cả khi các
  yêu cầu được gửi đồng thời.
- **SC-002**: 0 trường hợp số dư âm, và 0 trường hợp số dư bị trừ mà không có đơn hàng tương ứng
  (hoặc ngược lại, có đơn hàng mà không trừ tiền).
- **SC-003**: 0 trường hợp một customer nhận gói một lần hai lần cho cùng một Product.
- **SC-004**: 0 trường hợp mua thành công khi quyền còn hiệu lực hoặc đang bị thu hồi; và 0 lần mua
  trả về lỗi hệ thống vì trạng thái quyền mâu thuẫn.
- **SC-005**: 100% dòng hàng hiển thị đúng giá và thời lượng tại thời điểm mua sau khi Publisher đã
  sửa giá hoặc bỏ gói.
- **SC-006**: Sau khi mua thành công, Product xuất hiện trong danh sách Product của customer và
  kiểm tra quyền trả "được dùng" ngay ở yêu cầu kế tiếp, không có độ trễ đồng bộ.
- **SC-007**: Khi nhiều lần mua đồng thời cạnh tranh cùng một customer hoặc cùng một Product, đúng
  một lần thành công và các lần còn lại nhận lý do nghiệp vụ rõ ràng (hoặc lời nhắc thử lại), không
  phải lỗi hệ thống.

## Assumptions

- Đơn vị tiền là số nguyên của hệ thống, giống đơn vị số dư hiện có; không dùng số thực và không có
  đa tiền tệ.
- Đơn hàng chính là bản ghi ghi nợ số dư; MVP không thêm sổ cái ví riêng cho chiều trừ tiền
  (Constitution VI — không thêm trừu tượng cho nhu cầu giả định).
- Mỗi đơn hàng chỉ có một dòng hàng; không có giỏ hàng nhiều Product trong MVP.
- Customer bình thường đều có hồ sơ chứa số dư; trường hợp thiếu hồ sơ được xử lý như một lý do
  từ chối riêng (xem Edge Cases), không phải lỗi hệ thống. Tài khoản bị cấm đã bị chặn ở bước
  đăng nhập.
- Gói thuê bao luôn có giá lớn hơn 0 và thời lượng hữu hạn; chỉ gói một lần mới được miễn phí
  và/hoặc vĩnh viễn — đây là ràng buộc đã có của tính năng Product Offer, spec này dựa vào nó chứ
  không định nghĩa lại.
- Một Product chỉ bán được khi đang có ít nhất một gói thuê bao — ràng buộc đã có của Product Offer.
- Admin xem và can thiệp đơn hàng, hoàn tiền, huỷ đơn, ghi nhận doanh thu và chia tiền cho Publisher
  đều nằm ngoài phạm vi, để spec sau.
- Tên Product trong lịch sử lấy theo tên hiện tại của Product; chỉ điều khoản thương mại mới cần bản
  sao bất biến.
- Tài liệu trong `a2matex-docs` không được cập nhật trong phạm vi spec này; tài liệu được cập nhật
  sau khi code hoàn tất và test xong.
