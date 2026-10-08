# Feature Specification: Triển khai a2matex-be lên VPS qua CI/CD

**Feature Branch**: `001-vps-deployment`

**Created**: 2026-10-08

**Status**: Implemented (đặc tả viết lại sau khi triển khai, phản ánh hệ thống đang chạy thật tại `api.a2matex.com`)

**Input**: User description: "Viết lại toàn bộ docs/deployment-spec.md (kiến trúc triển khai a2matex-be lên VPS: Docker Compose, GHCR, reverse proxy, CI/CD qua GitHub Actions, migration trước khi thay container, backup/vận hành) theo đúng template spec.md của speckit. Đây là tính năng đã triển khai phần lớn, nên spec cần phản ánh đúng trạng thái hiện tại."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Deploy tự động khi merge code (Priority: P1)

Lập trình viên merge thay đổi vào nhánh `staging`. Hệ thống tự kiểm tra chất lượng, đóng
gói, và đưa phiên bản mới lên server production mà không cần ai thao tác tay.

**Why this priority**: đây là giá trị cốt lõi của cả hệ thống deploy — không có việc này
thì mọi lần đưa code lên production đều phải làm tay, dễ sai và chậm.

**Independent Test**: merge một commit vào `staging`, quan sát tab Actions của GitHub,
xác nhận API ở domain production phản hồi phiên bản mới mà không ai đăng nhập vào VPS.

**Acceptance Scenarios**:

1. **Given** code đã pass lint và test cục bộ, **When** merge vào `staging`, **Then** hệ
   thống tự build, kiểm tra lại lint/test, đóng gói, và cập nhật server production.
2. **Given** lint hoặc test thất bại trong lúc build, **When** pipeline chạy đến bước đó,
   **Then** pipeline dừng lại, không có phiên bản mới nào được đưa lên server, server vẫn
   chạy phiên bản cũ.
3. **Given** một migration cơ sở dữ liệu lỗi cú pháp, **When** pipeline chạy bước áp
   migration, **Then** phiên bản app cũ tiếp tục chạy, không có gián đoạn dịch vụ.

---

### User Story 2 - Quay lại phiên bản trước khi có lỗi (Priority: P2)

Sau khi một phiên bản mới lên production bị phát hiện có lỗi, người vận hành cần đưa
server quay lại phiên bản chạy ổn ngay trước đó, không cần build lại từ đầu.

**Why this priority**: giảm thời gian gián đoạn dịch vụ khi có lỗi; không có khả năng này
thì mỗi lần sự cố phải sửa code và build lại mới khôi phục được, mất nhiều thời gian hơn.

**Independent Test**: chọn một phiên bản đã từng chạy thành công trước đó, yêu cầu hệ
thống đưa server về đúng phiên bản đó, xác nhận server phản hồi như phiên bản cũ mà không
tốn thời gian build.

**Acceptance Scenarios**:

1. **Given** một phiên bản đã từng deploy thành công trước đó, **When** người vận hành chỉ
   định phiên bản đó để deploy lại, **Then** server chuyển sang đúng phiên bản đó mà không
   build lại, và việc quay lại không tự ý thay đổi dữ liệu đã lưu trong cơ sở dữ liệu.

---

### User Story 3 - Khôi phục dữ liệu sau sự cố (Priority: P3)

Khi cơ sở dữ liệu production bị mất hoặc hỏng, người vận hành cần khôi phục lại dữ liệu từ
bản sao lưu gần nhất mà không mất quá nhiều dữ liệu.

**Why this priority**: bảo vệ dữ liệu người dùng là yêu cầu tối thiểu để vận hành dịch vụ
thật; không có sao lưu thì một sự cố ổ đĩa là mất toàn bộ dữ liệu vĩnh viễn.

**Independent Test**: khôi phục một bản sao lưu vào một cơ sở dữ liệu trống, xác nhận dữ
liệu khôi phục đầy đủ và hệ thống hoạt động lại bình thường với dữ liệu đó.

**Acceptance Scenarios**:

1. **Given** một bản sao lưu được tạo trong vòng 24 giờ gần nhất, **When** khôi phục bản đó
   vào cơ sở dữ liệu trống, **Then** toàn bộ dữ liệu tại thời điểm sao lưu được phục hồi.

---

### Edge Cases

- Route mới được thêm vào nhưng chưa có ai chạy lại việc gán quyền cho route đó: route trả
  lỗi "không có quyền" cho tất cả mọi người, kể cả tài khoản quản trị, cho đến khi việc gán
  quyền được chạy. Đây là hành vi đã biết, không phải lỗi hệ thống.
- Tên miền đổi sang một tên chưa trỏ DNS đúng: hệ thống xin chứng chỉ HTTPS thất bại liên
  tục; nhà cung cấp chứng chỉ giới hạn số lần thử hỏng mỗi giờ, nên phải xác nhận DNS đúng
  trước khi đổi tên miền.
- Deploy diễn ra đúng lúc có request đang xử lý: request được giữ chờ một khoảng ngắn thay
  vì bị trả lỗi, miễn phiên bản mới lên thay thế trong thời gian giữ chờ đó.
- Quay lại phiên bản cũ sau khi đã có thay đổi schema cơ sở dữ liệu không tương thích
  ngược: việc quay lại chỉ đổi phiên bản app, không tự quay lại schema cơ sở dữ liệu — đây
  là giới hạn đã biết, cần xử lý riêng theo từng trường hợp.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Hệ thống MUST tự động build, kiểm tra (lint, test) và đóng gói phiên bản mới
  mỗi khi có thay đổi được merge vào nhánh triển khai chính, không cần thao tác tay.
- **FR-002**: Hệ thống MUST dừng pipeline và không đưa phiên bản mới lên production nếu
  bước kiểm tra chất lượng (lint hoặc test) thất bại.
- **FR-003**: Hệ thống MUST áp các thay đổi cơ sở dữ liệu (migration) trước khi thay phiên
  bản app đang chạy; nếu migration thất bại, phiên bản app cũ MUST tiếp tục chạy.
- **FR-004**: Mỗi phiên bản được đóng gói MUST có một định danh duy nhất gắn với đúng commit
  đã tạo ra nó, để có thể xác định và quay lại đúng phiên bản đó sau này.
- **FR-005**: Người vận hành MUST có khả năng chỉ định một phiên bản đã từng chạy thành
  công trước đó và yêu cầu hệ thống chuyển production sang đúng phiên bản đó mà không cần
  đóng gói lại.
- **FR-006**: Hệ thống MUST phục vụ API qua HTTPS với chứng chỉ hợp lệ, tự xin và tự gia hạn
  mà không cần thao tác tay định kỳ.
- **FR-007**: Cơ sở dữ liệu và cache MUST không thể truy cập trực tiếp từ bên ngoài mạng nội
  bộ của hệ thống; chỉ thành phần ứng dụng được phép kết nối tới chúng.
- **FR-008**: Thông tin bí mật (khóa, mật khẩu, API key) MUST không được lưu trong mã nguồn
  của repository; chúng chỉ tồn tại trên server đích hoặc trong kho secrets riêng.
- **FR-009**: Hệ thống MUST cung cấp một endpoint kiểm tra tình trạng hoạt động (health
  check) không yêu cầu đăng nhập, để xác nhận dịch vụ đang chạy.
- **FR-010**: Khi một route mới được thêm hoặc route cũ bị thay đổi, việc gán quyền truy
  cập cho route đó MUST được thực hiện lại (hiện tại là một bước làm tay sau deploy, không
  tự động) trước khi route đó được xác nhận là hoạt động đúng cho người dùng có quyền.
- **FR-011**: Hệ thống MUST sao lưu dữ liệu cơ sở dữ liệu định kỳ hằng ngày và giữ lại ít
  nhất 14 ngày sao lưu gần nhất.
- **FR-012**: Người vận hành MUST có khả năng khôi phục dữ liệu từ một bản sao lưu vào một
  cơ sở dữ liệu trống và lấy lại đầy đủ dữ liệu tại thời điểm sao lưu đó.
- **FR-013**: Danh sách dependency của ứng dụng dùng để build image production được resolve
  mới hoàn toàn ở mỗi lần build (không dùng lockfile cố định). Đây là lựa chọn có chủ đích,
  tạm thời giữ nguyên — xác nhận lại ngày 2026-10-08. Rủi ro đã biết: hai lần build của cùng
  một commit có thể lấy hai bản dependency khác nhau trong range version khai báo; chấp
  nhận đánh đổi này để giữ quy trình đơn giản.

### Key Entities

- **Phiên bản triển khai (Deployment)**: một lần đóng gói ứng dụng, gắn với một commit cụ
  thể, có một định danh duy nhất, có thể được chọn lại để quay lui.
- **Bản sao lưu (Backup)**: một tập dữ liệu cơ sở dữ liệu tại một thời điểm, có hạn giữ lại
  (retention) giới hạn.
- **Quyền truy cập route (Route Permission)**: liên kết giữa một route API và việc một vai
  trò người dùng có được gọi route đó hay không; phải được cập nhật khi route thay đổi.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Một thay đổi code được merge vào nhánh triển khai chính thì có mặt trên
  production trong vòng 10 phút, không cần ai can thiệp tay.
- **SC-002**: Khi bước kiểm tra chất lượng thất bại, production không bao giờ nhận một
  phiên bản chưa qua kiểm tra — tỉ lệ này là 100%.
- **SC-003**: Quay lại một phiên bản đã chạy ổn trước đó mất dưới 3 phút và không cần đóng
  gói lại.
- **SC-004**: Khôi phục dữ liệu từ bản sao lưu gần nhất vào một cơ sở dữ liệu trống phục hồi
  đầy đủ dữ liệu tại thời điểm sao lưu, kiểm chứng được bằng cách so khớp số lượng bản ghi.
- **SC-005**: Trong suốt một lần deploy, người dùng cuối không nhận lỗi kết nối (request bị
  giữ chờ thay vì bị từ chối) trong hơn 95% các lần đo thử liên tục trong lúc deploy.
- **SC-006**: Không có thông tin bí mật nào (khóa, mật khẩu) xuất hiện trong lịch sử commit
  của repository, kiểm tra được bằng cách rà soát mã nguồn đã commit.

## Assumptions

- "Nhánh triển khai chính" hiện tại là `staging` — nhánh này đang đóng vai trò channel
  production thật, chưa có một nhánh `production` tách riêng. Khi nào tách nhánh riêng,
  spec này cần cập nhật lại tên nhánh ở các yêu cầu liên quan (xem Out of Scope).
- Ba điểm từng là "quyết định còn mở" trong bản spec cũ (`docs/deployment-spec.md`) thực tế
  đã được chốt trong lúc triển khai, spec này ghi lại đúng lựa chọn đã chốt:
  - Reverse proxy: **Caddy** (không dùng nginx) — tự xin và tự gia hạn chứng chỉ.
  - `package-lock.json`: **không** commit vào repo; CI resolve dependency mới mỗi lần build.
    Xác nhận lại ngày 2026-10-08: giữ nguyên tạm thời (xem FR-013).
  - Seed quyền sau khi đổi route: **làm tay**, không tự động mỗi lần deploy (FR-010).

## Out of Scope

- Tách nhánh `production` riêng khỏi `staging` — đã được nêu ra là việc sẽ làm sau, chưa
  nằm trong phạm vi spec này. Khi làm, cần một spec riêng vì nó đổi cách FR-001 áp dụng.
- Môi trường staging thật (tách biệt với production) — hiện chưa có.
- Giám sát và cảnh báo tự động khi dịch vụ gặp sự cố.
- Gửi bản sao lưu ra ngoài VPS (hiện sao lưu chỉ nằm tại chỗ).
- Chạy nhiều instance ứng dụng song song (hiện chỉ một container app).
