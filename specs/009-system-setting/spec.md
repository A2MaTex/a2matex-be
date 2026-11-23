# Feature Specification: Kho cấu hình vận hành do quản trị viên quản lý

**Feature Branch**: `feat/system-setting`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "System Setting — kho cấu hình runtime cho admin, phase 1 của module
payout. Mục tiêu: admin đổi được các giá trị cấu hình vận hành từ Admin Portal mà không cần sửa
code, không cần deploy, không cần restart container."

**Nguồn thiết kế**: `a2matex-docs/components/a2matex-backend/commerce_entitlement_execution/payout.md`
— mục 3 (Delivery phases), 4.1 (SystemSetting), 5 (SQL contract, phần Phase 1), 11.1, 11.6 và 16
(Acceptance criteria, Phase 1). Khi spec và doc lệch nhau, doc trong repo docs là nguồn đúng về
thiết kế tổng thể; spec này là nguồn đúng về phạm vi phase 1.

**Vị trí trong lộ trình**: đây là phase 1 trong 5 phase của module payout. Phase 2 (chia hoa hồng)
sẽ là bên tiêu thụ đầu tiên của tỉ lệ hoa hồng. Trong phase 1 **chưa có ai đọc giá trị đó** — nó
chỉ được lưu, xác thực và đọc lại được.

**Quy ước đặt tên**: spec này gọi các giá trị cấu hình bằng tên nghiệp vụ. Định danh kỹ thuật
tương ứng, hình dạng dữ liệu và cơ chế lưu trữ nằm trong [data-model.md](./data-model.md) mục 3;
các quyết định kỹ thuật và bằng chứng từ mã nguồn nằm trong [research.md](./research.md).

## Clarifications

### Session 2026-11-23

- Q: Tỉ lệ hoa hồng lấy từ đâu? → A: Quản trị viên phải tự điều chỉnh được, để đổi mức hoa hồng
  không còn phải sửa phần mềm. Hệ quả: giá trị thuộc về dữ liệu vận hành, không thuộc về bản
  triển khai.
- Q: Biểu diễn tỉ lệ ra sao? → A: Số nguyên theo đơn vị phần vạn (3000 = 30%), không dùng số thực.
  Lý do đã kiểm chứng bằng thực nghiệm: ở mức hoa hồng 29%, phép nhân số thực cho kết quả lệch tại
  7.030 trên 2 triệu mức giá thử (ví dụ giá 100 cho ra 28 thay vì 29). Ở phase 2, tổng của phần
  hoa hồng và phần người bán bắt buộc khớp đúng tổng tiền, nên lệch 1 đơn vị là đơn hàng không ghi
  được.
- Q: Cấu hình thanh toán có chuyển sang kho cấu hình không? → A: Chỉ 3 giá trị hiển thị cho khách
  (số tài khoản, tên ngân hàng, tên chủ tài khoản). Các giá trị bí mật dùng để xác thực với nhà
  cung cấp thanh toán **ở lại cấu hình triển khai**. Hai lý do kỹ thuật cụ thể được ghi trong
  [research.md](./research.md) mục 1; tóm tắt nghiệp vụ: hệ thống chưa có cách cất giữ bí mật an
  toàn trong dữ liệu vận hành, và việc chuyển sẽ biến lỗi-lúc-khởi-động thành lỗi-lúc-phát-sinh —
  đúng hình dạng sự cố ngày 17/11 đã làm hệ thống ngừng phục vụ 11 tiếng.
- Q: Chu kỳ đối soát thanh toán có chuyển sang không? → A: Không. Giá trị đó quyết định lịch chạy
  của tác vụ nền, vốn được cố định khi dịch vụ khởi động.
- Q: Có cần nơi lưu riêng cho lịch sử thay đổi cấu hình không? → A: Không. Lịch sử gắn liền với
  chính giá trị cấu hình đó, theo đúng cách hệ thống đang ghi lịch sử cho tài khoản người dùng và
  cho quyền truy cập sản phẩm.
- Q: Mức hoa hồng khởi tạo? → A: 30%, coi là giả định vì quản trị viên đổi được ngay mà không cần
  phát hành lại phần mềm.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Đổi tài khoản ngân hàng nhận tiền nạp (Priority: P1)

Sàn đổi tài khoản ngân hàng nhận tiền nạp của khách. Quản trị viên vào trang quản trị, sửa số tài
khoản, tên ngân hàng và tên chủ tài khoản. Màn hình nạp tiền của khách hiển thị thông tin mới ngay
lập tức.

Hiện tại việc này đòi hỏi can thiệp trực tiếp vào máy chủ và khởi động lại dịch vụ — một lần gián
đoạn phục vụ cho một thay đổi không liên quan gì tới phần mềm.

**Why this priority**: đây là giá trị dùng được ngay, kể cả khi toàn bộ module payout dừng lại ở
đây. Ba giá trị này là những thứ thực tế có thay đổi trong vận hành.

**Independent Test**: đổi giá trị từ trang quản trị rồi mở màn hình nạp tiền, thấy giá trị mới mà
không khởi động lại dịch vụ.

**Acceptance Scenarios**:

1. **Given** hệ thống đang chạy với số tài khoản cũ, **When** quản trị viên đổi sang số mới,
   **Then** lần hiển thị tiếp theo cho khách dùng số mới mà không cần khởi động lại dịch vụ.
2. **Given** quản trị viên vừa đổi thông tin ngân hàng, **When** xem lại giá trị cấu hình đó,
   **Then** thấy người đổi, thời điểm đổi, giá trị trước và giá trị sau.
3. **Given** một người dùng không phải quản trị viên, **When** gọi chức năng đổi cấu hình,
   **Then** bị từ chối và không giá trị nào thay đổi.

---

### User Story 2 - Đặt tỉ lệ hoa hồng cho sàn (Priority: P2)

Quản trị viên đặt tỉ lệ hoa hồng mà sàn giữ lại trên mỗi đơn hàng. Giá trị được lưu, xác thực và
đọc lại đúng, sẵn sàng cho phase 2 tiêu thụ.

**Why this priority**: là lý do module này tồn tại, nhưng trong phase 1 chưa có bên tiêu thụ nên
giá trị nghiệp vụ chưa hiện ra. Tách khỏi P1 để phase 1 vẫn dùng được nếu phần này phải chờ.

**Independent Test**: đặt tỉ lệ, đọc lại thấy đúng; đặt giá trị ngoài khoảng cho phép thì bị từ
chối, kể cả khi đi vòng qua ứng dụng.

**Acceptance Scenarios**:

1. **Given** hệ thống vừa được triển khai lần đầu, **When** đọc tỉ lệ hoa hồng, **Then** nhận được
   mức khởi tạo 30%.
2. **Given** quản trị viên đặt tỉ lệ 25%, **When** đọc lại, **Then** nhận đúng 25%.
3. **Given** quản trị viên đặt một tỉ lệ lớn hơn 100%, **When** lưu, **Then** bị từ chối và giá trị
   cũ giữ nguyên.
4. **Given** một người có quyền thao tác trực tiếp trên dữ liệu, **When** ghi một tỉ lệ âm mà không
   đi qua ứng dụng, **Then** hệ thống vẫn từ chối.

---

### User Story 3 - Trang quản trị tự dựng được biểu mẫu cấu hình (Priority: P3)

Trang quản trị hiển thị danh sách cấu hình sửa được mà không phải gắn cứng danh sách đó ở phía giao
diện. Khi hệ thống bổ sung một mục cấu hình mới, giao diện tự có thêm ô nhập tương ứng.

**Why this priority**: tiện cho vận hành và giảm việc phải sửa song song hai nơi, nhưng cấu hình
vẫn đổi được nếu phần này chưa xong.

**Independent Test**: mở danh sách cấu hình, mỗi mục có đủ mô tả và ràng buộc giá trị để dựng ô
nhập; bổ sung một mục mới ở phía hệ thống thì nó tự xuất hiện.

**Acceptance Scenarios**:

1. **Given** hệ thống khai báo 4 mục cấu hình, **When** giao diện lấy danh sách, **Then** nhận đủ 4
   mục kèm giá trị hiện tại, mô tả và ràng buộc giá trị.
2. **Given** hệ thống khai báo thêm mục thứ 5, **When** giao diện lấy lại danh sách, **Then** mục
   mới xuất hiện mà không cần sửa giao diện.

---

### Edge Cases

- Yêu cầu sửa một **mục cấu hình không được khai báo** → từ chối, không tạo mục mới. Đây là thứ
  giữ cho kho cấu hình không biến thành nơi chứa dữ liệu tuỳ tiện.
- Gửi giá trị **sai hình dạng** so với khai báo của mục đó → từ chối trước khi có gì được lưu.
- Tỉ lệ hoa hồng **ngoài khoảng 0%–100%** → từ chối, kể cả khi ghi trực tiếp vào dữ liệu không qua
  ứng dụng. Đây là mục duy nhất đụng tới tiền nên không dựa vào một lớp bảo vệ.
- Khi khởi động mà **thiếu giá trị của một mục đã khai báo**, hoặc giá trị lưu không còn hợp lệ →
  dịch vụ phải từ chối khởi động, không chạy tiếp với giá trị đoán.
- **Hai quản trị viên sửa cùng một mục gần như cùng lúc** → cả hai lần sửa đều phải còn dấu vết,
  không mất lần nào.
- Sửa thành **đúng giá trị đang có** → chấp nhận, không bắt buộc ghi thêm lịch sử.
- **Lần chuyển đổi**: hệ thống đang chạy có sẵn giá trị ngân hàng thật trong cấu hình triển khai.
  Quá trình đưa chúng sang kho cấu hình không được để khách nhìn thấy thông tin chuyển khoản trống.
- Giá trị ngân hàng đang **để trống** → phải báo lỗi rõ ràng, không hiển thị ô trống cho khách
  chuyển tiền vào.

## Requirements *(mandatory)*

### Functional Requirements

**Lưu trữ và xác thực**

- **FR-001**: Hệ thống PHẢI lưu mỗi mục cấu hình thành một giá trị độc lập, có cấu trúc, sửa được
  tại chỗ.
- **FR-002**: Hệ thống PHẢI có một nơi khai báo tập mục cấu hình hợp lệ, mỗi mục kèm ràng buộc giá
  trị và mô tả bằng lời.
- **FR-003**: Hệ thống PHẢI từ chối mọi thao tác đọc hoặc ghi lên mục cấu hình không được khai báo.
- **FR-004**: Hệ thống PHẢI xác thực giá trị gửi lên theo đúng ràng buộc của mục đó trước khi lưu.
- **FR-005**: Hệ thống PHẢI đảm bảo tỉ lệ hoa hồng không hợp lệ **không thể tồn tại trong dữ liệu**,
  kể cả khi được ghi vào bằng công cụ thao tác dữ liệu trực tiếp thay vì qua ứng dụng.
- **FR-006**: Hệ thống PHẢI từ chối khởi động dịch vụ khi một mục cấu hình đã khai báo bị thiếu giá
  trị hoặc có giá trị không hợp lệ. Không được âm thầm thay bằng giá trị mặc định.

**Lịch sử thay đổi**

- **FR-007**: Hệ thống PHẢI ghi lại mỗi lần thay đổi kèm người thực hiện, thời điểm, giá trị trước
  và giá trị sau, gắn liền với chính mục cấu hình đó.
- **FR-008**: Lịch sử thay đổi PHẢI chỉ được thêm vào, không sửa và không xoá được qua bất kỳ chức
  năng nào của ứng dụng.

**Giao diện quản trị**

- **FR-009**: Quản trị viên PHẢI xem được toàn bộ mục cấu hình đã khai báo kèm giá trị hiện tại, mô
  tả và ràng buộc giá trị, đủ để giao diện dựng ô nhập mà không gắn cứng danh sách mục.
- **FR-010**: Quản trị viên PHẢI sửa được giá trị của một mục tại một thời điểm.
- **FR-011**: Mọi chức năng cấu hình PHẢI yêu cầu đăng nhập và có bản ghi phân quyền tương ứng,
  tạo ra trong cùng lần thay đổi.
- **FR-011b**: Sau khi phân quyền cho chức năng mới, quản trị viên PHẢI dùng được ngay. Không được
  bị từ chối vì hệ thống còn dùng lại dữ liệu phân quyền cũ.
- **FR-012**: Người không phải quản trị viên PHẢI bị từ chối ở mọi chức năng cấu hình.

**Phạm vi mục cấu hình và việc chuyển đổi**

- **FR-013**: Phase 1 PHẢI khai báo đúng 4 mục: tỉ lệ hoa hồng của sàn, số tài khoản ngân hàng nhận
  tiền nạp, tên ngân hàng, tên chủ tài khoản.
- **FR-014**: Việc chuyển 3 giá trị ngân hàng từ cấu hình triển khai sang kho cấu hình PHẢI không
  tạo ra khoảng thời gian nào khách nhìn thấy thông tin chuyển khoản trống.
- **FR-015**: Sau khi chuyển, màn hình nạp tiền PHẢI lấy 3 giá trị ngân hàng từ kho cấu hình, không
  còn lấy từ cấu hình triển khai.
- **FR-016**: Các giá trị bí mật dùng để xác thực với nhà cung cấp thanh toán, và chu kỳ đối soát,
  PHẢI ở lại cấu hình triển khai và giữ nguyên cách xác thực lúc khởi động như hiện tại.
- **FR-017**: Ngay từ lần triển khai đầu tiên, hệ thống PHẢI có sẵn bản ghi cho **toàn bộ** mục cấu
  hình đã khai báo, với tỉ lệ hoa hồng mang giá trị khởi tạo và 3 giá trị ngân hàng để trống.
- **FR-018**: Khi một giá trị ngân hàng đang để trống, màn hình nạp tiền PHẢI báo lỗi rõ ràng thay
  vì trả về giá trị trống cho khách.

**Dùng lại ở nơi khác**

- **FR-019**: Hệ thống PHẢI cung cấp cách đọc cấu hình dùng chung cho các phần khác, để phase 2 đọc
  tỉ lệ hoa hồng mà không phải tự truy cập nơi lưu trữ.

### Key Entities

- **Mục cấu hình (System Setting)**: một giá trị vận hành do quản trị viên quản lý. Mỗi mục có một
  định danh duy nhất, một giá trị có cấu trúc, dấu vết lần sửa gần nhất (ai, lúc nào), và toàn bộ
  lịch sử thay đổi của chính nó. Vòng đời: được tạo sẵn khi triển khai, sau đó chỉ được sửa, không
  bị xoá qua ứng dụng.
- **Bản khai báo mục cấu hình (Setting Registry)**: danh mục quy định mục nào tồn tại, giá trị hợp
  lệ hình dạng ra sao, và mô tả để hiển thị. Không nằm trong dữ liệu vận hành — đây là thứ khiến
  **thêm một mục mới** là thay đổi phần mềm có kiểm duyệt, còn **đổi giá trị** thì không cần.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Đổi thông tin tài khoản ngân hàng nhận tiền nạp không còn cần truy cập máy chủ và
  không gây gián đoạn phục vụ. Thao tác hoàn tất trong vòng 1 phút từ trang quản trị.
- **SC-002**: Giá trị mới có hiệu lực ngay ở lần sử dụng kế tiếp, không cần khởi động lại dịch vụ.
- **SC-003**: 100% nỗ lực ghi một mục không được khai báo, hoặc ghi giá trị sai hình dạng, bị từ
  chối mà không có giá trị nào bị tạo hay sửa.
- **SC-004**: Không tồn tại tỉ lệ hoa hồng nằm ngoài 0%–100% trong dữ liệu, kể cả khi ghi trực tiếp
  không qua ứng dụng.
- **SC-005**: Mọi thay đổi cấu hình đều truy ngược được ra người thực hiện và thời điểm.
- **SC-006**: Dịch vụ không khởi động được khi cấu hình đã khai báo bị thiếu hoặc hỏng, thay vì
  chạy với giá trị đoán.
- **SC-007**: Sau khi hoàn tất chuyển đổi, màn hình nạp tiền hiển thị đúng thông tin ngân hàng như
  trước khi chuyển, và không có thời điểm nào hiển thị thông tin trống.
- **SC-008**: Bổ sung một mục cấu hình mới không đòi hỏi sửa giao diện trang quản trị.

## Assumptions

- Mức hoa hồng khởi tạo là 30%. Đây là giả định chứ không phải quyết định đã chốt, chấp nhận được
  vì quản trị viên đổi được ngay mà không cần phát hành lại phần mềm; chủ repo xác nhận ở phiên
  2026-11-23.
- Phase 1 không có bên nào tiêu thụ tỉ lệ hoa hồng. Phase 2 là bên đọc đầu tiên.
- Chỉ có một vai trò được sửa cấu hình là quản trị viên. Chưa có nhu cầu phân quyền nhỏ hơn theo
  từng mục, nên bản khai báo chỉ cần mô tả ràng buộc giá trị, chưa cần mô tả quyền.
- Số lượng mục ở quy mô vài chục và được đọc thưa, nên chưa cần lưu tạm giá trị để tăng tốc.
- Hai quản trị viên sửa đồng thời là tình huống hiếm; chấp nhận lần ghi sau thắng, miễn là cả hai
  lần sửa đều còn dấu vết trong lịch sử.
- Khả năng cất giữ bí mật của hệ thống giữ nguyên trong phase này. Việc đưa bí mật vào dữ liệu vận
  hành cần một cơ chế mã hoá dùng chung và không thuộc phạm vi phase 1.
- Việc chuyển đổi được thực hiện qua hai lần phát hành liên tiếp; chi tiết trình tự nằm trong
  [plan.md](./plan.md).

## Out of Scope

- Mọi logic chia hoa hồng, ví người bán, sổ ghi giao dịch, rút tiền và hoàn tiền — thuộc phase 2
  đến phase 5 của module payout.
- Cất giữ giá trị bí mật trong kho cấu hình.
- Đặt lịch cho một giá trị cấu hình có hiệu lực vào thời điểm tương lai.
- Phân quyền sửa cấu hình theo từng mục.
- Giao diện trang quản trị — spec này chỉ định nghĩa phần hệ thống phục vụ nó.
