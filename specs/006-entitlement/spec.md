# Feature Specification: Entitlement — quyền sử dụng Product của customer

**Feature Branch**: `006-entitlement`

**Created**: 2026-11-21

**Status**: Draft

**Input**: User description: "Viết spec cho Entitlement Module: quyền dài hạn của customer đối với
Product, Admin cấp quyền thủ công và thu hồi quyền, và một cách kiểm tra quyền dùng chung cho
Order, Download và Execution Lease. Áp dụng các quyết định đã chốt: quyền bị thu hồi chặn mua lại
và chỉ Admin gỡ được; Admin cấp quyền là thao tác ghi đè; khi gỡ thu hồi thì xoá thông tin thu hồi
khỏi quyền hiện tại, lịch sử nằm trong nhật ký kiểm toán."

**Related spec**: [`007-order`](../007-order/spec.md) — mua hàng là cách duy nhất để customer tự có
quyền; việc mua và việc cấp quyền phải thành công hoặc thất bại cùng nhau.

**Planning input**: [`planning-notes.md`](./planning-notes.md) — các quyết định kỹ thuật đã thảo
luận (thứ tự khoá, ràng buộc dữ liệu, mã lỗi, route), dùng làm đầu vào cho `/speckit-plan`.

## Clarifications

### Session 2026-11-21

- Q: Customer bị thu hồi quyền có được tự mua lại Product đó không? → A: Không. Quyền bị thu hồi
  chặn mọi lần mua mới của customer đó với Product đó, bất kể thời hạn còn lại hay loại gói. Chỉ
  Admin gỡ được bằng cách cấp quyền lại. Lý do: thu hồi là quyết định kiểm duyệt có lý do và được
  ghi lại; cho tự mua lại thì vô hiệu quyết định đó; hành vi nhất quán cho mọi trường hợp (gói còn
  hạn, đã hết hạn, gói vĩnh viễn); giống cách Product bị tạm khoá chỉ Admin mở lại được.
- Q: Admin cấp quyền khi customer đã có quyền với Product thì sao? → A: Cấp quyền là thao tác **đặt
  lại** thời hạn theo giá trị Admin nhập, áp dụng cho mọi tình huống (chưa từng có quyền, đã hết
  hạn, đang còn hạn, đang bị thu hồi). Không làm thay đổi lịch sử mua của customer.
- Q: Khi gỡ thu hồi, thông tin thu hồi (thời điểm, người thu hồi, lý do) xử lý thế nào? → A: Xoá
  khỏi trạng thái quyền hiện tại để dữ liệu không mâu thuẫn; toàn bộ lịch sử thu hồi và cấp quyền
  được giữ trong lịch sử kiểm toán của quyền, chỉ ghi thêm, không sửa.
- Q: Admin có được cấp quyền cho Product chưa bán (nháp), đã ngừng bán hoặc đang bị tạm khoá
  không? → A: Không. Chỉ cấp được cho Product đang bán; làm đơn giản trước. Hệ quả: muốn UAT một
  Product thì Product đó phải đang bán.
- Q: Admin cấp quyền có được làm rút ngắn thời hạn customer đã trả tiền không? → A: Có. Cấp quyền
  luôn ghi đè đúng giá trị Admin nhập; lịch sử kiểm toán lưu giá trị trước và sau để tra soát.
- Q: Có cần tác vụ định kỳ chuyển quyền quá hạn sang "hết hạn" không? → A: Không. Trạng thái hết
  hạn được xác định khi đọc bằng cách so thời hạn với thời điểm hiện tại.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Admin cấp quyền thủ công cho customer (Priority: P1)

Admin cần cấp cho một customer quyền dùng một Product mà không qua mua hàng — cho tester khi UAT,
đền bù khi Product lỗi, hoặc tặng đối tác. Admin chọn customer, Product, hạn dùng (hoặc vĩnh viễn)
và nhập lý do; customer có quyền ngay lập tức.

**Why this priority**: MVP ưu tiên Product miễn phí và cấp quyền thủ công để hành trình publish →
tải → chạy không phải chờ tính năng mua hàng. Đây cũng là cách duy nhất gỡ thu hồi (Story 3), và
là cách nhanh nhất để có dữ liệu quyền thật cho các tính năng tải và chạy phát triển song song.

**Independent Test**: Admin cấp quyền 30 ngày cho một customer chưa từng mua Product; customer mở
danh sách Product của mình thấy Product đó ở trạng thái đang có hiệu lực với hạn đúng 30 ngày; kiểm
tra quyền trả về "được dùng".

**Acceptance Scenarios**:

1. **Given** customer chưa từng có quyền với Product, **When** Admin cấp quyền với hạn trong tương
   lai và lý do, **Then** customer có quyền bắt đầu từ thời điểm cấp đến hạn Admin nhập; quyền được
   ghi nhận là do Admin cấp, kèm Admin thực hiện; một bản ghi kiểm toán được tạo.
2. **Given** quyền của customer đã hết hạn, **When** Admin cấp quyền, **Then** quyền đó được kích
   hoạt lại với thời hạn mới; customer vẫn chỉ có một quyền với Product đó.
3. **Given** customer đang còn 10 ngày từ gói đã mua, **When** Admin cấp 90 ngày, **Then** thời hạn
   được đặt lại thành 90 ngày tính từ lúc cấp; lịch sử mua (gói đã mua, việc đã dùng gói một lần)
   giữ nguyên; bản ghi kiểm toán lưu giá trị trước và sau.
4. **Given** Admin không nhập hạn dùng, **When** cấp quyền, **Then** customer có quyền vĩnh viễn.
5. **Given** hạn dùng không ở tương lai, hoặc thiếu lý do, hoặc customer/Product không tồn tại,
   **When** Admin cấp quyền, **Then** yêu cầu bị từ chối với lý do rõ ràng và không có gì thay đổi.
6. **Given** Product đang nháp, đã ngừng bán hoặc đang bị tạm khoá, **When** Admin cấp quyền,
   **Then** yêu cầu bị từ chối vì Product không ở trạng thái đang bán, không có gì thay đổi.

---

### User Story 2 - Customer xem danh sách Product của mình (Priority: P1)

Customer muốn xem danh sách Product mình đang có hoặc từng có quyền, kèm trạng thái và hạn dùng,
để biết Product nào đang dùng được và mở Product đó trong Launcher.

**Why this priority**: Marketplace Web và Launcher đều dựa vào danh sách này; không có nó customer
không biết mình sở hữu gì sau khi mua hoặc được cấp quyền.

**Independent Test**: với một customer có ba quyền (một còn hạn, một hết hạn, một bị thu hồi),
mở danh sách và thấy đủ ba Product với đúng trạng thái.

**Acceptance Scenarios**:

1. **Given** customer có quyền còn hạn, **When** xem danh sách, **Then** Product hiển thị trạng thái
   đang có hiệu lực, kèm ngày bắt đầu, ngày hết hạn (hoặc "vĩnh viễn"), tên Product, Publisher và
   trạng thái của Product.
2. **Given** quyền đã quá hạn, **When** xem danh sách, **Then** Product hiển thị trạng thái hết hạn,
   kể cả khi hệ thống chưa chủ động cập nhật trạng thái đó.
3. **Given** quyền bị thu hồi, **When** xem danh sách, **Then** Product hiển thị trạng thái bị thu
   hồi; lý do thu hồi và người thu hồi KHÔNG hiển thị cho customer.
4. **Given** một customer khác, **When** xem danh sách của họ, **Then** không thấy quyền của
   customer này.

---

### User Story 3 - Admin thu hồi quyền (Priority: P2)

Admin phát hiện customer vi phạm điều khoản với một Product và cần thu hồi quyền của customer đó
với Product đó, kèm lý do bắt buộc.

**Why this priority**: là công cụ kiểm duyệt ở mức một customer với một Product; quan trọng nhưng
không nằm trên hành trình chính publish → mua → chạy.

**Independent Test**: thu hồi một quyền đang còn hạn; kiểm tra quyền trả "không được dùng"; customer
mua lại Product đó bị từ chối; Admin cấp quyền lại thì customer dùng được trở lại.

**Acceptance Scenarios**:

1. **Given** quyền chưa bị thu hồi (còn hạn hoặc đã hết hạn), **When** Admin thu hồi kèm lý do,
   **Then** quyền chuyển sang bị thu hồi, ghi nhận thời điểm, Admin thực hiện và lý do; thời hạn cũ
   giữ nguyên; một bản ghi kiểm toán được tạo.
2. **Given** quyền đã bị thu hồi, **When** Admin thu hồi lần nữa, **Then** bị từ chối, không thay
   đổi gì.
3. **Given** quyền bị thu hồi, **When** customer cố tải hoặc chạy Product, **Then** kiểm tra quyền
   trả "không được dùng", kể cả khi thời hạn còn hoặc là vĩnh viễn.
4. **Given** quyền bị thu hồi, **When** Admin cấp quyền lại, **Then** quyền trở về có hiệu lực với
   thời hạn mới, thông tin thu hồi không còn gắn với quyền hiện tại, nhưng vẫn tra được trong lịch
   sử kiểm toán.

---

### User Story 4 - Admin tra cứu quyền (Priority: P3)

Admin cần tìm quyền theo customer và/hoặc Product để xem trạng thái hiện tại trước khi cấp hoặc thu
hồi.

**Why this priority**: hỗ trợ vận hành; giai đoạn đầu có thể tra cứu trực tiếp trong cơ sở dữ liệu.

**Independent Test**: lọc theo customer hoặc theo Product, nhận về danh sách có phân trang với đầy
đủ thông tin, kể cả thông tin thu hồi và nguồn cấp quyền.

**Acceptance Scenarios**:

1. **Given** Admin lọc theo một customer, **When** tra cứu, **Then** nhận mọi quyền của customer đó
   với trạng thái hiện tại và đầy đủ thông tin quản trị.

---

### Edge Cases

- Quyền đã quá hạn nhưng trạng thái lưu vẫn là "có hiệu lực": mọi quyết định đều dựa vào thời hạn,
  không dựa vào trạng thái lưu. MVP không cần tác vụ định kỳ để cập nhật trạng thái hết hạn.
- Thu hồi quyền đã hết hạn: được phép — mục đích là chặn customer mua lại.
- Thu hồi quyền vĩnh viễn: chặn dùng ngay; chỉ Admin cấp quyền lại mới gỡ được.
- Admin cấp quyền làm rút ngắn thời hạn customer đã trả tiền: được phép vì Admin là bên được tin cậy
  và thao tác có chủ đích; bản ghi kiểm toán lưu giá trị trước và sau để tra soát.
- Admin cấp quyền cho Product đang nháp, đã ngừng bán hoặc đang bị tạm khoá: bị từ chối; chỉ Product
  đang bán mới cấp được. Thu hồi quyền thì không phụ thuộc trạng thái Product.
- Product bị tạm khoá **sau khi** đã cấp quyền: quyền giữ nguyên, nhưng kiểm tra quyền trả "không
  được dùng" cho đến khi Product được mở lại (FR-010).
- Product hoặc customer đã bị xoá: cấp quyền bị từ chối.
- Admin cấp quyền và customer mua hàng cho cùng một Product cùng lúc, khi customer chưa từng có
  quyền: kết quả vẫn chỉ có một quyền; thao tác đến sau thấy trạng thái mới nhất và xử lý theo đó.
- Admin cấp quyền cho customer đang bị cấm tài khoản: vẫn ghi nhận, nhưng customer bị cấm đã bị chặn
  đăng nhập nên không dùng được.

## Requirements *(mandatory)*

### Functional Requirements

**Quyền và trạng thái**

- **FR-001**: Mỗi customer PHẢI có tối đa **một** quyền với mỗi Product. Mua hàng hay cấp quyền về
  sau đều cập nhật quyền này, không tạo thêm quyền mới cho mỗi kỳ.
- **FR-002**: Mỗi quyền PHẢI ghi nhận: thời điểm bắt đầu kỳ hiện tại, thời điểm hết hạn (hoặc vĩnh
  viễn), nguồn cấp gần nhất (mua hàng hoặc Admin cấp), Admin đã cấp (nếu do Admin cấp), lần mua và
  gói gần nhất, thời điểm customer dùng gói một lần lần đầu, phạm vi sử dụng các bản phát hành, và
  thông tin thu hồi (nếu đang bị thu hồi).
- **FR-003**: Thời điểm customer dùng gói một lần lần đầu chỉ được ghi bởi tính năng mua hàng và
  KHÔNG BAO GIỜ bị xoá — kể cả khi quyền hết hạn, bị thu hồi hay được Admin cấp lại.
- **FR-004**: Trạng thái hiển thị của quyền PHẢI được xác định như sau: "bị thu hồi" nếu quyền đang
  bị thu hồi; ngược lại "hết hạn" nếu thời hạn đã qua; ngược lại "có hiệu lực".
- **FR-005**: Hệ thống PHẢI đảm bảo không tồn tại quyền mâu thuẫn: quyền đang bị thu hồi luôn có đủ
  thời điểm, người thu hồi và lý do; quyền không bị thu hồi không mang thông tin thu hồi. Thời điểm
  hết hạn (nếu có) luôn sau thời điểm bắt đầu.
- **FR-006**: Trong MVP, phạm vi sử dụng bản phát hành của mọi quyền là như nhau: được dùng bản phát
  hành hiện tại và các bản còn được hỗ trợ, được cập nhật lên bản mới.

**Kiểm tra quyền dùng chung**

- **FR-010**: Hệ thống PHẢI có một cách kiểm tra quyền duy nhất dùng chung cho các tính năng tải
  Product, Launcher và cấp phép chạy. Customer **được dùng** Product khi và chỉ khi: có quyền, quyền
  không bị thu hồi, quyền chưa hết hạn (hoặc vĩnh viễn), Product chưa bị xoá và Product không bị
  tạm khoá. Product đã ngừng bán vẫn được dùng. Việc kiểm tra bản phát hành cụ thể KHÔNG thuộc phạm
  vi này.
- **FR-011**: Hệ thống PHẢI cho phép tính năng mua hàng tạo mới hoặc kích hoạt lại quyền **như một
  phần không tách rời của lần mua**: nếu lần mua thất bại thì quyền không đổi, và ngược lại. Quyền
  kích hoạt từ mua hàng bắt đầu từ thời điểm mua, hết hạn sau đúng thời lượng của gói (hoặc vĩnh
  viễn), không cộng dồn kỳ cũ, ghi nhận nguồn là mua hàng cùng lần mua và gói tương ứng, và ghi thời
  điểm dùng gói một lần nếu đây là lần đầu. Các quy tắc chặn mua thuộc spec 007.
- **FR-012**: Mọi so sánh thời gian trong quyết định quyền PHẢI dùng một nguồn thời gian thống nhất
  của hệ thống, không phụ thuộc đồng hồ của từng máy chủ ứng dụng.

**Admin cấp quyền**

- **FR-020**: Admin PHẢI cấp được quyền với: customer, Product, hạn dùng (thời điểm trong tương lai
  hoặc vĩnh viễn) và lý do (bắt buộc, không rỗng, có độ dài tối đa).
- **FR-021**: Cấp quyền là thao tác đặt lại, áp dụng cho mọi tình huống: quyền trở về có hiệu lực,
  bắt đầu từ thời điểm cấp, hết hạn theo giá trị Admin nhập, ghi nhận nguồn là Admin cấp kèm Admin
  thực hiện, và không còn mang thông tin thu hồi. Thao tác này KHÔNG thay đổi lịch sử mua (lần mua
  và gói gần nhất, thời điểm dùng gói một lần), KHÔNG tạo đơn hàng và KHÔNG trừ số dư.
- **FR-022**: Cấp quyền PHẢI bị từ chối khi customer không tồn tại, đã bị xoá hoặc chưa có hồ sơ
  (Profile), khi Product không tồn tại hoặc đã bị xoá, khi
  Product không ở trạng thái đang bán (nháp, ngừng bán, tạm khoá), hoặc khi hạn dùng không ở tương
  lai; mỗi trường hợp có lý do từ chối riêng.

**Admin thu hồi quyền**

- **FR-030**: Admin PHẢI thu hồi được một quyền kèm lý do bắt buộc. Thu hồi áp dụng cho quyền chưa
  bị thu hồi, dù còn hạn hay đã hết hạn.
- **FR-031**: Thu hồi ghi nhận thời điểm, Admin thực hiện và lý do; giữ nguyên thời hạn và lịch sử
  mua.
- **FR-032**: Thu hồi quyền đã bị thu hồi, hoặc quyền không tồn tại, PHẢI bị từ chối với lý do riêng
  cho từng trường hợp.
- **FR-033**: Thu hồi có hiệu lực ngay: kiểm tra quyền (FR-010) trả "không được dùng" từ yêu cầu kế
  tiếp, và customer không mua lại được (spec 007). Việc dừng các lần chạy đang diễn ra thuộc spec
  cấp phép chạy.

**Kiểm toán**

- **FR-040**: Mỗi lần Admin cấp hoặc thu hồi quyền PHẢI tạo đúng một bản ghi kiểm toán chỉ ghi thêm,
  gồm: Admin thực hiện, hành động, quyền bị tác động, giá trị trước (trống nếu tạo mới), giá trị sau
  và lý do. Nếu không ghi được bản ghi kiểm toán thì thao tác PHẢI bị huỷ toàn bộ.
- **FR-041**: Việc tạo/kích hoạt lại quyền từ mua hàng KHÔNG tạo bản ghi kiểm toán; lịch sử của nó
  là đơn hàng.

**Truy cập**

- **FR-050**: Customer PHẢI xem được danh sách quyền của chính mình có phân trang, gồm: Product (tên,
  đường dẫn, trạng thái), Publisher, trạng thái hiển thị, ngày bắt đầu, ngày hết hạn và nguồn cấp.
  KHÔNG hiển thị lý do thu hồi, người thu hồi hay Admin đã cấp.
- **FR-051**: Admin PHẢI tra cứu được quyền có phân trang, lọc theo customer và/hoặc Product, với đầy
  đủ thông tin quản trị, bao gồm toàn bộ lịch sử kiểm toán của từng quyền (để kiểm chứng SC-005).
- **FR-052**: Chỉ Admin được cấp, thu hồi và tra cứu quyền của người khác; customer chỉ xem được
  quyền của chính mình.

### Key Entities *(include if feature involves data)*

- **Quyền sử dụng (Entitlement)** (mới): quyền hiện tại của một customer với một Product; mỗi cặp
  customer–Product có tối đa một. Thuộc tính như FR-002. Liên kết tới customer, Product, gói và lần
  mua gần nhất, Admin cấp và Admin thu hồi.
- **Lịch sử kiểm toán của quyền** (mới, gắn liền với từng quyền): danh sách chỉ ghi thêm các bản ghi
  kiểm toán của lần Admin cấp/thu hồi quyền đó — ai làm, làm gì, giá trị trước/sau, lý do, khi nào.
  Không bị xoá khi quyền được cấp lại. Nhật ký kiểm toán dùng chung cho nhiều loại đối tượng nằm ngoài
  phạm vi spec này.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Sau khi Admin cấp quyền, customer thấy Product trong danh sách của mình và kiểm tra
  quyền trả "được dùng" ngay ở yêu cầu kế tiếp, không có độ trễ đồng bộ.
- **SC-002**: Sau khi Admin thu hồi, 100% lần kiểm tra quyền cho customer đó với Product đó trả
  "không được dùng", bất kể thời hạn.
- **SC-003**: 0 trường hợp một customer có hai quyền với cùng một Product, kể cả khi nhiều thao tác
  xảy ra đồng thời.
- **SC-004**: 0 quyền ở trạng thái mâu thuẫn (có hiệu lực nhưng mang thông tin thu hồi, hoặc bị thu
  hồi nhưng thiếu thông tin thu hồi).
- **SC-005**: 100% lần Admin cấp/thu hồi thành công có đúng một bản ghi kiểm toán với giá trị
  trước/sau; toàn bộ lịch sử thu hồi của một quyền vẫn tra được sau khi quyền đã được cấp lại.

## Assumptions

- UAT bằng cấp quyền thủ công chỉ áp dụng cho Product đang bán; nhu cầu cấp quyền cho Product nháp
  (test trước khi phát hành) nếu phát sinh sẽ xử lý ở spec sau.
- Customer bị cấm tài khoản đã bị chặn ở bước đăng nhập hiện có; kiểm tra quyền không xét lại trạng
  thái tài khoản.
- Không có tác vụ định kỳ cập nhật trạng thái hết hạn trong MVP; trạng thái hết hạn được xác định
  khi đọc.
- Thông báo cho customer khi được cấp hoặc bị thu hồi quyền nằm ngoài phạm vi.
- Không giới hạn số máy, thiết bị hay số lần chạy đồng thời.
- Tải Product, Launcher và cấp phép chạy là các spec riêng; spec này chỉ cung cấp cách kiểm tra
  quyền (FR-010) cho chúng.
- Tài liệu trong `a2matex-docs` không được cập nhật trong phạm vi spec này; tài liệu được cập nhật
  sau khi code hoàn tất và test xong.
