# Feature Specification: Nạp tiền cho user qua Sepay

**Feature Branch**: `002-sepay-wallet-topup`

**Created**: 2026-10-08

**Status**: Draft

**Input**: User description: "Toi muốn xử lí tính năng nạp tiền cho user thông qua Sepay. Số tiền được nạp sẽ được hiển thị dựa vào 1 field trong bảng profile (nếu chưa có thì thêm vào)."

## Clarifications

### Session 2026-10-08

- Q: Hệ thống có cần xác thực rằng một thông báo giao dịch nhận được thực sự đến từ Sepay
  (không bị giả mạo) trước khi cộng tiền vào số dư user không? → A: Có — thêm 1 FR bắt
  buộc yêu cầu xác thực nguồn thông báo; thông báo không xác thực được bị từ chối và ghi
  log giám sát an ninh, không khóa cứng cơ chế xác thực cụ thể trong spec.
- Q: Nếu Sepay không gửi được thông báo giao dịch cho hệ thống (lỗi mạng, downtime) dù
  user đã chuyển khoản thành công, hệ thống có cần tự chủ động kiểm tra lại với Sepay để
  không bỏ sót giao dịch đó không? → A: Có — hệ thống PHẢI có khả năng đối soát chủ động
  với Sepay, không chỉ phụ thuộc một chiều vào việc Sepay tự gửi thông báo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Nạp tiền qua chuyển khoản, số dư tự cập nhật (Priority: P1)

User muốn nạp tiền vào tài khoản của mình. User yêu cầu nạp tiền, hệ thống đưa ra thông
tin chuyển khoản gắn riêng cho yêu cầu đó, user chuyển khoản qua ngân hàng, và ngay khi
Sepay xác nhận giao dịch đã về, số dư của user tự động tăng lên — không cần ai xử lý tay.

**Why this priority**: đây là giá trị lõi của toàn bộ tính năng — nếu không tự động cập
nhật số dư thì tính năng không có ý nghĩa, mọi phần khác (hiển thị số dư, lịch sử) đều
phụ thuộc vào bước này hoạt động đúng.

**Independent Test**: tạo một yêu cầu nạp tiền, thực hiện chuyển khoản thật (hoặc giả lập
giao dịch Sepay) đúng với thông tin được cấp, xác nhận số dư trên profile của user tăng
đúng số tiền đã chuyển, không cần ai đăng nhập hệ thống để cộng tay.

**Acceptance Scenarios**:

1. **Given** user đã đăng nhập, **When** user tạo yêu cầu nạp tiền, **Then** hệ thống trả
   về thông tin chuyển khoản (số tiền, nội dung/mã tham chiếu riêng cho yêu cầu đó).
2. **Given** user đã chuyển khoản đúng nội dung/mã tham chiếu được cấp, **When** Sepay báo
   giao dịch đã về, **Then** số dư của user tăng đúng bằng số tiền thực tế đã chuyển, và
   một bản ghi giao dịch nạp tiền được lưu lại.
3. **Given** một giao dịch nạp tiền đã được cộng vào số dư, **When** Sepay báo lại cùng
   giao dịch đó lần thứ hai (trùng), **Then** số dư KHÔNG bị cộng thêm lần nữa.
4. **Given** một giao dịch chuyển khoản về mà không khớp được với mã tham chiếu của bất kỳ
   yêu cầu nạp tiền nào, **When** hệ thống nhận giao dịch đó, **Then** giao dịch được lưu
   lại ở trạng thái "chưa khớp" để nhân viên hỗ trợ xử lý tay, không bị cộng nhầm vào số dư
   của ai và không bị mất.

---

### User Story 2 - Xem số dư hiện tại (Priority: P2)

User muốn biết mình đang có bao nhiêu tiền trong tài khoản, để biết có cần nạp thêm hay
không.

**Why this priority**: là lý do user quan tâm đến việc nạp tiền ngay từ đầu; không xem
được số dư thì user không biết yêu cầu nạp ở Story 1 có thành công hay không.

**Independent Test**: sau khi một giao dịch nạp tiền được cộng thành công (Story 1), user
mở trang hồ sơ cá nhân và thấy số dư đã được cập nhật, khớp với số tiền đã nạp.

**Acceptance Scenarios**:

1. **Given** user đã nạp tiền thành công trước đó, **When** user xem trang hồ sơ cá nhân,
   **Then** hệ thống hiển thị đúng số dư hiện tại.
2. **Given** user chưa từng nạp tiền, **When** user xem trang hồ sơ cá nhân, **Then** số
   dư hiển thị là 0.

---

### Edge Cases

- User chuyển khoản sai số tiền (nhiều hơn hoặc ít hơn số đã khai báo khi tạo yêu cầu) →
  hệ thống cộng theo số tiền thực tế nhận được, không theo số tiền user đã khai báo ban
  đầu.
- User chuyển khoản nhưng quên hoặc chuyển sai nội dung/mã tham chiếu → giao dịch rơi vào
  trạng thái "chưa khớp" (xem Acceptance Scenario 4 ở Story 1), không tự động cộng cho ai.
- User tạo nhiều yêu cầu nạp tiền liên tiếp trước khi yêu cầu trước được xác nhận → mỗi
  yêu cầu có mã tham chiếu riêng, không bị nhầm lẫn giao dịch của nhau.
- Sepay báo một giao dịch về chậm hoặc với độ trễ lớn → giao dịch vẫn được xử lý và cộng
  đúng khi hệ thống nhận được, không bị bỏ sót chỉ vì đến muộn.
- Một thông báo giao dịch giả mạo hoặc không xác thực được là đến từ Sepay → bị từ chối
  ngay, không ảnh hưởng đến số dư của ai, và được ghi log để theo dõi an ninh (FR-010).
- Sepay không gửi được thông báo cho một giao dịch chuyển khoản đã thực sự xảy ra (lỗi
  mạng/downtime phía Sepay) → hệ thống vẫn phát hiện được giao dịch đó qua đối soát chủ
  động, không bị bỏ sót vĩnh viễn chỉ vì thiếu thông báo (FR-011).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Hệ thống PHẢI cho phép user đã đăng nhập tạo một yêu cầu nạp tiền và nhận
  lại thông tin chuyển khoản gắn riêng cho yêu cầu đó (không dùng chung cho nhiều yêu cầu
  khác nhau).
- **FR-002**: Hệ thống PHẢI tự động nhận biết khi một giao dịch chuyển khoản ngân hàng
  khớp với một yêu cầu nạp tiền đang chờ, không cần người vận hành kiểm tra hoặc cộng tay.
- **FR-003**: Hệ thống PHẢI cộng vào số dư của user đúng bằng số tiền thực tế đã nhận được
  từ giao dịch chuyển khoản tương ứng.
- **FR-004**: Hệ thống PHẢI gán mỗi giao dịch chuyển khoản nhận được cho đúng một user.
  Giao dịch không khớp được với yêu cầu nạp tiền nào KHÔNG được cộng vào số dư của bất kỳ
  user nào, và PHẢI được giữ lại ở trạng thái có thể xem/xử lý tay sau đó.
- **FR-005**: Hệ thống PHẢI đảm bảo mỗi giao dịch chuyển khoản chỉ được cộng vào số dư
  đúng một lần, kể cả khi Sepay báo lại cùng một giao dịch nhiều lần.
- **FR-006**: Hệ thống PHẢI lưu lại một bản ghi không thể sửa đổi cho mỗi giao dịch nạp
  tiền (số tiền, thời điểm, trạng thái, user được gán) để phục vụ đối soát và hỗ trợ user
  khi có tranh chấp.
- **FR-007**: Hệ thống PHẢI hiển thị số dư hiện tại của user khi user xem hồ sơ cá nhân
  của chính mình.
- **FR-008**: Bảng profile PHẢI có một field lưu số dư của user; field này PHẢI được thêm
  vào nếu hiện chưa tồn tại, với giá trị khởi tạo là 0 cho user hiện có.
- **FR-009**: Field số dư là **số dư hiện tại** (current balance) của user — số tiền user
  đang có, tăng khi nạp tiền thành công, và có thể bị trừ bởi các tính năng tiêu/dùng tiền
  khác trong tương lai (nền cho ví điện tử). Tính năng này chỉ triển khai phần nạp tiền
  (tăng số dư); phần trừ tiền thuộc tính năng khác, nhưng field PHẢI được thiết kế để chịu
  được việc đó mà không cần đổi ý nghĩa dữ liệu sau này.
- **FR-010**: Hệ thống PHẢI xác thực rằng mỗi thông báo giao dịch nhận được thực sự đến từ
  Sepay trước khi xử lý. Thông báo không xác thực được nguồn gốc PHẢI bị từ chối, KHÔNG
  được dùng để cộng tiền cho bất kỳ user nào, và PHẢI được ghi log để phục vụ giám sát an
  ninh.
- **FR-011**: Hệ thống PHẢI có khả năng chủ động đối soát lại với Sepay (không chỉ chờ
  Sepay gửi thông báo) để phát hiện các giao dịch chuyển khoản đã thực sự xảy ra nhưng
  chưa từng được thông báo, đảm bảo không có giao dịch hợp lệ nào bị bỏ sót vĩnh viễn.

### Key Entities *(include if feature involves data)*

- **Profile (cập nhật)**: thêm field số dư (balance) của user — số dư hiện tại, có thể bị
  trừ bởi tính năng khác trong tương lai (ví điện tử); tăng mỗi khi có giao dịch nạp tiền
  được xác nhận. Trong phạm vi tính năng này chỉ có chiều tăng (nạp tiền).
- **Giao dịch nạp tiền (Top-up Transaction)**: thực thể mới, đại diện cho một lần nạp
  tiền — gồm user liên quan, số tiền yêu cầu, số tiền thực tế nhận được, mã tham chiếu,
  trạng thái (đang chờ / đã khớp & cộng tiền / chưa khớp được ai), và thời điểm. Là nguồn
  sự thật duy nhất để đối soát số dư trên Profile.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Số dư của user được cập nhật trong vòng 60 giây sau khi **hệ thống nhận
  được thông báo giao dịch từ Sepay** (không tính thời gian Sepay tự xử lý/gửi thông báo
  về phía hệ thống — phần đó nằm ngoài khả năng kiểm soát của hệ thống, xem Edge Case
  "Sepay báo giao dịch về chậm"), không cần user hay nhân viên hỗ trợ can thiệp tay.
- **SC-002**: 0% giao dịch nạp tiền bị cộng trùng vào số dư (mỗi giao dịch chuyển khoản
  chỉ được tính một lần, bất kể được báo lại bao nhiêu lần).
- **SC-003**: 0% giao dịch chuyển khoản hợp lệ bị thất lạc — mọi giao dịch không khớp được
  user vẫn được giữ lại và nhìn thấy được để xử lý tay, không bị bỏ sót.
- **SC-004**: User có thể xem được số dư hiện tại, chính xác của mình bất cứ lúc nào trên
  trang hồ sơ cá nhân.
- **SC-005**: 100% thông báo giao dịch không xác thực được là đến từ Sepay bị từ chối —
  không có trường hợp nào bị cộng nhầm vào số dư của user từ một nguồn chưa xác thực.
- **SC-006**: Một giao dịch chuyển khoản hợp lệ nhưng bị thiếu thông báo từ Sepay vẫn được
  phát hiện và cộng bù trong vòng tối đa 24 giờ nhờ đối soát chủ động, không cần user tự
  phát hiện và báo cáo trước.

## Assumptions

- Đơn vị tiền tệ là VND; Sepay chỉ hỗ trợ giao dịch ngân hàng nội địa Việt Nam.
- User phải đăng nhập mới tạo được yêu cầu nạp tiền; không hỗ trợ nạp tiền ẩn danh.
- Không áp giới hạn số tiền nạp tối thiểu/tối đa ở tầng ứng dụng trong v1 — giới hạn chuyển
  khoản (nếu có) do ngân hàng/Sepay quyết định.
- Màn hình xem lại lịch sử chi tiết các lần nạp tiền KHÔNG thuộc phạm vi v1 — v1 chỉ hiển
  thị số dư hiện tại; bản ghi giao dịch nạp tiền (FR-006) phục vụ đối soát nội bộ/hỗ trợ,
  chưa cần giao diện cho user tự xem.
- Việc trừ/sử dụng số dư (thanh toán, mua hàng, v.v.) KHÔNG thuộc phạm vi tính năng này —
  field số dư (FR-009) là số dư hiện tại, có thể bị trừ bởi tính năng khác sau này, nhưng
  cơ chế trừ tiền đó chưa được thiết kế hay triển khai ở đây.
- 24 giờ (SC-006) là **ngưỡng SLA tối đa** để phát hiện một giao dịch bị thiếu thông báo —
  không phải chu kỳ đối soát (polling interval) thực tế. Chu kỳ đối soát thực tế do
  `/speckit-plan` chọn (xem `research.md`/`plan.md`), chỉ cần đủ ngắn để nằm trong ngưỡng
  24 giờ này.
