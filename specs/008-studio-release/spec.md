# Feature Specification: Studio Release — quản lý bản phát hành ứng dụng Studio

**Feature Branch**: `feat/studio-release`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "Studio release management — quản lý bản phát hành của app desktop
Studio (client soạn workflow), để Studio tự kiểm tra và tải bản cập nhật. Mô hình bám sát module
`launcher-release` đã có trong repo. Bốn quyết định đã chốt với chủ repo: không tách
Windows/macOS; không có hash/checksum; số phiên bản phải đúng semver nghiêm ngặt và duy nhất; cho
phép kích hoạt bản có số phiên bản thấp hơn để rollback."

**Reference implementation**: `src/routes/launcher-release/` và bảng `LauncherRelease` — tính năng
tương đương đã chạy cho ứng dụng Launcher, không có spec đi kèm (viết trước khi áp dụng spec-kit).
Spec này mô tả tính năng song song cho Studio.

**Plan**: [`plan.md`](./plan.md) — cùng bộ artifact [`research.md`](./research.md),
[`data-model.md`](./data-model.md), [`contracts/studio-release-api.md`](./contracts/studio-release-api.md),
[`quickstart.md`](./quickstart.md). Khi spec và plan lệch nhau về chi tiết kỹ thuật, plan là nguồn
đúng; khi lệch về hành vi nghiệp vụ, spec là nguồn đúng và plan phải sửa.

**Planning input**: [`planning-notes.md`](./planning-notes.md) — ghi chép trước plan, nay đã được
`research.md` thay thế ở phần lớn nội dung.

## Clarifications

### Session 2026-11-23

- Q: Có tách bản cài đặt theo hệ điều hành (Windows/macOS) không? → A: Không. Mỗi bản phát hành gắn
  đúng một tệp cài đặt, giống Launcher. Hệ quả: khi cần hỗ trợ hệ điều hành thứ hai sẽ phải đổi cấu
  trúc dữ liệu, chấp nhận trả giá sau.
- Q: Có kèm giá trị băm (checksum) của tệp cài đặt để Studio kiểm tra tính toàn vẹn tệp tải về
  không? → A: Không — cố ý bỏ, giữ đúng như Launcher. Hệ quả đã được nêu và chủ repo chấp nhận:
  Studio không tự phát hiện được tệp tải thiếu byte, tệp hỏng, hoặc tệp bị thay trong kho lưu trữ
  mà không qua API.
- Q: Quy tắc cho số phiên bản là gì? → A: Bắt buộc đúng định dạng semver nghiêm ngặt, và duy nhất
  trong toàn bộ các bản phát hành Studio. Đây là điểm **khác** Launcher (Launcher đang nhận chuỗi
  tự do và cho phép trùng).
- Q: Có chặn kích hoạt bản có số phiên bản thấp hơn bản đang hiệu lực không? → A: Không chặn. Giữ
  khả năng rollback nhanh về bản cũ khi bản mới lỗi, bằng đúng một thao tác.
- Q: Studio lấy tệp cài đặt bằng đường nào, khi mọi đường tải tệp hiện có của hệ thống đều yêu cầu
  đăng nhập? → A: **Giữ nguyên như Launcher** — phải đăng nhập mới tải được tệp cài đặt. Truy vấn
  bản hiện hành vẫn công khai nhưng chỉ cho biết có bản mới và trỏ tới tệp, không cấp đường tải.
  Hệ quả đã nêu và được chấp nhận: người chưa đăng nhập biết có bản mới nhưng không tự tải được,
  nên phần công khai của truy vấn này chủ yếu còn giá trị thông báo.
- Q: Có cách nào gỡ bản đang hiệu lực mà không cần kích hoạt bản khác không? → A: Có, bổ sung thao
  tác **gỡ hiệu lực**. Cần cho trường hợp bản phát hành *đầu tiên* bị lỗi — khi đó không tồn tại
  bản cũ nào để kích hoạt thay.
- Q: Admin có được sửa bản đang hiệu lực không? → A: Chỉ sửa được **ghi chú phát hành**. Số phiên
  bản và tệp cài đặt của bản đang hiệu lực bị khoá, để không xảy ra chuyện hai người dùng nhận hai
  tệp khác nhau dưới cùng một số phiên bản. Muốn đổi tệp thì gỡ hiệu lực rồi sửa, hoặc tạo bản mới
  — đây là lý do thao tác gỡ hiệu lực ở câu trên càng cần thiết. Khác Launcher, nơi sửa được tất cả.
- Q: Có áp các cải tiến này (semver, unique, trần trang, gỡ hiệu lực) ngược lại cho Launcher không?
  → A: Không trong phạm vi này. Launcher đang chạy production, để lại một thay đổi riêng. Chấp nhận
  trong thời gian đó hai module gần giống nhau nhưng khác hành vi.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Studio kiểm tra và tải bản cập nhật (Priority: P1)

Ứng dụng Studio trên máy người dùng cần biết bản mới nhất đang được phát hành là bản nào. Khi khởi
động, Studio hỏi hệ thống "bản hiện hành là gì", nhận về số phiên bản, ghi chú phát hành và tham
chiếu tới tệp cài đặt, rồi tự so với phiên bản đang chạy để quyết định có nhắc người dùng cập nhật
hay không.

**Why this priority**: đây là toàn bộ lý do tính năng tồn tại. Không có nó, người dùng Studio không
có đường nhận bản mới ngoài việc được gửi tệp thủ công. Các story còn lại chỉ là công cụ để tạo ra
dữ liệu cho story này.

**Independent Test**: với một bản phát hành đã được kích hoạt sẵn trong hệ thống, gọi truy vấn bản
hiện hành **không kèm thông tin đăng nhập** và nhận đủ số phiên bản, ghi chú, tham chiếu tệp và
thời điểm phát hành.

**Acceptance Scenarios**:

1. **Given** có một bản phát hành đang hiệu lực, **When** Studio truy vấn bản hiện hành mà không
   đăng nhập, **Then** hệ thống trả về số phiên bản, ghi chú phát hành, tham chiếu tệp cài đặt và
   thời điểm phát hành của đúng bản đó.
2. **Given** chưa bản nào được kích hoạt, **When** Studio truy vấn bản hiện hành, **Then** hệ thống
   trả lỗi không tìm thấy, và Studio hiểu là "chưa có bản nào để cập nhật".
3. **Given** bản đang hiệu lực có tệp cài đặt đã bị xoá khỏi kho tệp, **When** Studio truy vấn bản
   hiện hành, **Then** hệ thống coi như không có bản hiệu lực và trả lỗi không tìm thấy, thay vì
   trả về một bản không tải được.
4. **Given** Studio đã biết bản hiện hành và người dùng **chưa đăng nhập**, **When** người dùng
   yêu cầu tải tệp cài đặt, **Then** hệ thống từ chối; Studio phải đưa người dùng qua bước đăng
   nhập trước.
5. **Given** người dùng đã đăng nhập, **When** Studio dùng tham chiếu tệp lấy từ truy vấn bản hiện
   hành để tải, **Then** tệp cài đặt tải về được qua chức năng tải tệp sẵn có của hệ thống.

---

### User Story 2 - Admin đăng và kích hoạt một bản phát hành mới (Priority: P2)

Admin đã tải tệp cài đặt Studio lên kho tệp. Admin tạo một bản phát hành trỏ tới tệp đó kèm số
phiên bản và ghi chú, kiểm tra lại, rồi kích hoạt. Từ thời điểm kích hoạt, mọi Studio đang chạy sẽ
thấy bản này khi kiểm tra cập nhật. Khi phát hiện bản vừa công bố có vấn đề, Admin kích hoạt bản cũ
để quay lui, hoặc gỡ hiệu lực để hệ thống tạm thời không công bố bản nào.

**Why this priority**: không có story này thì không có dữ liệu cho Story 1. Tách riêng vì việc tạo
và việc công bố là hai quyết định khác nhau — tạo trước, soát lại, công bố sau.

**Independent Test**: tạo một bản phát hành mới, xác nhận nó **chưa** hiệu lực, kích hoạt nó, rồi
truy vấn bản hiện hành thấy đúng bản vừa kích hoạt; bản hiệu lực trước đó không còn hiệu lực.

**Acceptance Scenarios**:

1. **Given** một tệp cài đặt đã có trong kho tệp, **When** Admin tạo bản phát hành với số phiên bản
   hợp lệ, **Then** bản được tạo ở trạng thái chưa hiệu lực và chưa ảnh hưởng tới Studio.
2. **Given** một bản phát hành chưa hiệu lực, **When** Admin kích hoạt nó, **Then** bản đó thành
   bản hiệu lực duy nhất, mọi bản khác bị hạ khỏi trạng thái hiệu lực trong cùng một thao tác.
3. **Given** một bản chưa từng được kích hoạt, **When** Admin kích hoạt lần đầu, **Then** hệ thống
   ghi lại thời điểm phát hành; nếu sau này bản đó bị hạ rồi kích hoạt lại, thời điểm phát hành gốc
   được giữ nguyên.
4. **Given** bản đang hiệu lực, **When** Admin kích hoạt lại chính bản đó, **Then** hệ thống từ
   chối với lỗi xung đột.
5. **Given** bản phát hành có tệp cài đặt đã bị xoá, **When** Admin kích hoạt nó, **Then** hệ thống
   từ chối.
6. **Given** bản đang hiệu lực là `1.4.0` và tồn tại bản `1.3.0`, **When** Admin kích hoạt `1.3.0`,
   **Then** hệ thống chấp nhận và `1.3.0` trở thành bản hiện hành (rollback).
7. **Given** hai Admin cùng kích hoạt hai bản khác nhau gần như đồng thời, **When** cả hai yêu cầu
   được xử lý, **Then** kết thúc vẫn đúng một bản hiệu lực, không có trạng thái hai bản cùng hiệu
   lực.
8. **Given** bản `1.0.0` đang hiệu lực và là bản duy nhất trong hệ thống, **When** Admin gỡ hiệu
   lực bản đó, **Then** hệ thống không còn bản hiệu lực nào và truy vấn bản hiện hành trả lỗi không
   tìm thấy; bản `1.0.0` vẫn còn trong danh sách với thời điểm phát hành cũ.
9. **Given** một bản không ở trạng thái hiệu lực, **When** Admin gỡ hiệu lực bản đó, **Then** hệ
   thống từ chối với lỗi xung đột.

---

### User Story 3 - Admin tra cứu và sửa thông tin bản phát hành (Priority: P3)

Admin cần xem lại đã phát hành những bản nào, bản nào đang hiệu lực, tệp cài đặt tên gì và nặng bao
nhiêu; và sửa được thông tin đã nhập sai (ghi chú phát hành, số phiên bản gõ nhầm, trỏ nhầm tệp)
trước khi công bố.

**Why this priority**: tiện ích vận hành. Thiếu nó vẫn phát hành được, chỉ là sửa sai phải tạo bản
mới.

**Independent Test**: tạo vài bản phát hành, xem danh sách thấy đủ, mới nhất đứng trước, mỗi dòng
có tên tệp và dung lượng; mở chi tiết một bản thấy thêm thông tin tệp; sửa ghi chú và thấy thay đổi
được lưu.

**Acceptance Scenarios**:

1. **Given** nhiều bản phát hành đã tạo, **When** Admin xem danh sách, **Then** danh sách được phân
   trang, bản tạo gần nhất đứng trước, mỗi dòng cho biết số phiên bản, có đang hiệu lực không, tên
   tệp và dung lượng tệp.
2. **Given** một bản phát hành, **When** Admin mở chi tiết, **Then** thấy đầy đủ thông tin bản phát
   hành kèm tên tệp, kiểu nội dung và dung lượng.
3. **Given** một bản phát hành, **When** Admin gửi yêu cầu sửa không chứa trường nào, **Then** hệ
   thống từ chối.
4. **Given** đã tồn tại bản `2.0.0`, **When** Admin sửa một bản khác thành `2.0.0`, **Then** hệ
   thống từ chối vì trùng số phiên bản.
5. **Given** một bản đang hiệu lực, **When** Admin sửa ghi chú phát hành của bản đó, **Then** thay
   đổi được lưu; **When** Admin đổi tệp cài đặt hoặc số phiên bản của chính bản đó, **Then** hệ
   thống từ chối.

---

### Edge Cases

- Chưa có bản phát hành nào trong hệ thống → truy vấn bản hiện hành trả lỗi không tìm thấy, không
  trả về rỗng gây hiểu nhầm là "đã cập nhật xong".
- Tệp cài đặt bị xoá **sau khi** bản đã được kích hoạt → bản đó bị coi như không hiệu lực khi truy
  vấn, thay vì đẩy cho Studio một đường tải hỏng.
- Số phiên bản sai định dạng (`v1.2`, `1.2`, `1.2.3.4`, chuỗi rỗng) → từ chối ngay khi tạo hoặc
  sửa, không lưu.
- Trùng số phiên bản với một bản đã xoá mềm → vẫn bị chặn. Tình huống này chỉ phát sinh khi có
  người can thiệp thẳng vào dữ liệu, vì tính năng không có chức năng xoá bản phát hành (xem Out of
  Scope); khi đó cách xử lý đúng là xoá hẳn bản ghi chứ không xoá mềm.
- Admin sửa tệp cài đặt hoặc số phiên bản của bản **đang hiệu lực** → bị từ chối (FR-016). Đường
  đi đúng là gỡ hiệu lực, sửa, rồi kích hoạt lại — hoặc tạo hẳn bản mới.
- Hai Admin kích hoạt đồng thời → chỉ một yêu cầu thắng, không có cửa sổ thời gian nào hệ thống có
  hai bản cùng hiệu lực.
- Hai Admin tạo hai bản cùng số phiên bản gần như đồng thời → đúng một yêu cầu thành công, yêu cầu
  còn lại nhận lỗi trùng số phiên bản.
- Người dùng chưa đăng nhập bấm "cập nhật" → bước tải bị từ chối, Studio phải xử lý bằng cách yêu
  cầu đăng nhập; riêng việc *biết* có bản mới thì không cần đăng nhập.
- Admin yêu cầu một trang danh sách quá lớn → hệ thống chặn ở trần kích thước trang thay vì cố trả
  về toàn bộ.
- Tệp được trỏ tới **không phải** tệp cài đặt (ảnh, tài liệu) → hệ thống không kiểm tra, bản phát
  hành vẫn tạo được; xem Assumptions, đây là lựa chọn giữ nguyên hành vi Launcher.
- Tệp cài đặt của bản đang hiệu lực bị xoá qua chức năng quản lý tệp → **không có gì ngăn**, và tệp
  bị xoá khỏi kho lưu trữ trước khi bản ghi bị đánh dấu xoá, tức không khôi phục được. Hệ quả: hệ
  thống lập tức không còn bản hiệu lực nào cho tới khi Admin trỏ bản phát hành sang tệp khác.
- Bản phát hành có tệp đã bị xoá vẫn PHẢI hiện trong danh sách và chi tiết của Admin, để Admin nhìn
  ra vấn đề; chỉ truy vấn bản hiện hành mới bỏ qua nó.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Hệ thống PHẢI cho Admin tạo một bản phát hành Studio gồm số phiên bản, tham chiếu tới
  một tệp cài đặt đã có sẵn trong kho tệp, và ghi chú phát hành (tuỳ chọn).
- **FR-002**: Bản phát hành mới tạo PHẢI ở trạng thái **chưa hiệu lực**; việc tạo không bao giờ tự
  công bố.
- **FR-003**: Số phiên bản PHẢI theo đúng định dạng semver nghiêm ngặt — ba số nguyên
  `CHÍNH.PHỤ.VÁ`, không số 0 đứng đầu, **không** chấp nhận hậu tố tiền phát hành (`1.0.0-beta.1`)
  hay metadata dựng bản (`1.0.0+build.5`). Giá trị sai định dạng bị từ chối khi tạo và khi sửa.
  Hệ quả: không phát hành được bản beta qua kênh này, nhất quán với quyết định không tách kênh.
- **FR-004**: Số phiên bản PHẢI là duy nhất giữa các bản phát hành Studio; tạo hoặc sửa thành một
  số phiên bản đã tồn tại bị từ chối với lỗi xung đột.
- **FR-005**: Tệp cài đặt được tham chiếu PHẢI tồn tại trong kho tệp tại thời điểm tạo và sửa; nếu
  không, yêu cầu bị từ chối và lỗi PHẢI chỉ rõ trường tệp.
- **FR-006**: Admin PHẢI kích hoạt được một bản phát hành; sau khi kích hoạt thành công, hệ thống
  PHẢI đảm bảo **nhiều nhất một** bản ở trạng thái hiệu lực.
- **FR-007**: Việc kích hoạt PHẢI an toàn khi nhiều Admin thao tác đồng thời — không có kết cục nào
  để lại hai bản cùng hiệu lực, kể cả khi một yêu cầu thất bại giữa chừng.
- **FR-008**: Lần kích hoạt đầu tiên của một bản PHẢI ghi lại thời điểm phát hành. "Thời điểm phát
  hành" nghĩa là **lần đầu tiên bản đó được công bố**, không phải "đang hiệu lực từ lúc nào": gỡ
  hiệu lực rồi kích hoạt lại đều giữ nguyên giá trị gốc, kể cả khi ở giữa có quãng bản đó không
  hiệu lực.
- **FR-009**: Kích hoạt một bản đang hiệu lực PHẢI bị từ chối với lỗi xung đột.
- **FR-010**: Kích hoạt một bản có tệp cài đặt đã bị xoá PHẢI bị từ chối.
- **FR-011**: Hệ thống PHẢI cho phép kích hoạt bản có số phiên bản thấp hơn bản đang hiệu lực, để
  rollback thực hiện được bằng một thao tác duy nhất.
- **FR-012**: Ứng dụng Studio PHẢI lấy được thông tin bản hiệu lực **không cần đăng nhập**, gồm: số
  phiên bản, ghi chú phát hành, tham chiếu tệp cài đặt và thời điểm phát hành.
- **FR-013**: Khi không có bản hiệu lực, hoặc bản hiệu lực có tệp cài đặt đã bị xoá, truy vấn bản
  hiện hành PHẢI trả lỗi không tìm thấy.
- **FR-014**: Admin PHẢI xem được danh sách bản phát hành có phân trang, sắp xếp bản tạo gần nhất
  trước, mỗi dòng kèm tên tệp và dung lượng tệp.
- **FR-015**: Admin PHẢI xem được chi tiết một bản phát hành kèm thông tin tệp (tên, kiểu nội dung,
  dung lượng).
- **FR-016**: Admin PHẢI sửa được số phiên bản, tệp cài đặt và ghi chú phát hành của một bản
  **chưa hiệu lực**; yêu cầu sửa không chứa trường nào PHẢI bị từ chối. Với bản **đang hiệu lực**,
  chỉ ghi chú phát hành được sửa — mọi yêu cầu đổi số phiên bản hoặc tệp cài đặt của bản đang hiệu
  lực PHẢI bị từ chối; muốn đổi thì gỡ hiệu lực trước (FR-021) hoặc tạo bản mới.
- **FR-017**: Mọi thao tác trừ truy vấn bản hiện hành PHẢI yêu cầu quyền Admin. Permission cho các
  route mới PHẢI được seed trong cùng PR với code (Constitution Nguyên tắc II).
- **FR-018**: Bản phát hành đã xoá mềm PHẢI không xuất hiện trong danh sách, chi tiết, hay kết quả
  truy vấn bản hiện hành.
- **FR-019**: Mỗi thao tác ghi thành công — tạo, sửa, kích hoạt, gỡ hiệu lực — PHẢI được ghi log
  kèm định danh bản phát hành và người thực hiện, đủ để tra lại ai công bố hay gỡ bản nào, lúc
  nào.
- **FR-020**: Việc tải tệp cài đặt PHẢI đi qua chức năng tải tệp sẵn có của hệ thống và PHẢI yêu
  cầu đăng nhập; truy vấn bản hiện hành chỉ cung cấp tham chiếu tệp, không cấp đường tải. Tính năng
  này **không** mở thêm đường tải công khai nào.
- **FR-021**: Admin PHẢI gỡ được hiệu lực của bản đang hiệu lực. Sau khi gỡ, hệ thống không còn bản
  hiệu lực nào và truy vấn bản hiện hành trả lỗi không tìm thấy. Thao tác gỡ PHẢI giữ nguyên thời
  điểm phát hành đã ghi, và PHẢI bị từ chối nếu bản đó không ở trạng thái hiệu lực.
- **FR-022**: Danh sách bản phát hành PHẢI có trần kích thước trang; yêu cầu vượt trần PHẢI bị từ
  chối (không tự cắt về trần), giống cách danh sách sản phẩm công khai đang làm.
- **FR-023**: Danh sách và chi tiết dành cho Admin PHẢI hiển thị cả bản phát hành có tệp cài đặt đã
  bị xoá, để Admin phát hiện và xử lý; chỉ truy vấn bản hiện hành mới loại bản đó ra.

### Key Entities

- **Bản phát hành Studio**: một lần phát hành ứng dụng Studio. Thuộc tính: số phiên bản (semver,
  duy nhất), tham chiếu tệp cài đặt, ghi chú phát hành (có thể trống), cờ hiệu lực, thời điểm phát
  hành (chỉ có khi đã từng được kích hoạt, và luôn là lần đầu — xem FR-008), dấu thời gian
  tạo/sửa/xoá mềm. Quan hệ: trỏ tới đúng một tệp trong kho tệp.
- **Tệp cài đặt**: bản ghi tệp sẵn có trong kho tệp chung của hệ thống (đã dùng cho Launcher, ảnh
  sản phẩm, gói sản phẩm). Tính năng này chỉ **tham chiếu**, không tạo và không xoá tệp.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Studio xác định được có bản cập nhật hay không bằng **một** lần truy vấn duy nhất,
  không cần tài khoản hay đăng nhập.
- **SC-002**: Kể từ khi tệp cài đặt đã nằm trong kho tệp, Admin đưa được bản mới tới người dùng
  bằng đúng **2 thao tác** (tạo, kích hoạt), hoàn tất dưới 2 phút.
- **SC-003**: Trong 100% trường hợp, kể cả khi nhiều Admin kích hoạt đồng thời, truy vấn bản hiện
  hành trả về nhiều nhất một bản phát hành.
- **SC-004**: Quay về một bản cũ hơn hoàn tất bằng **1 thao tác**, không cần tạo bản phát hành mới
  và không cần tải lại tệp cài đặt.
- **SC-005**: 100% yêu cầu tạo hoặc sửa với số phiên bản sai định dạng hoặc trùng đều bị từ chối
  trước khi dữ liệu được lưu.
- **SC-006**: 100% câu trả lời của truy vấn bản hiện hành trỏ tới một tệp cài đặt chưa bị xoá khỏi
  kho tệp. Tệp còn bản ghi nhưng hỏng hoặc mất ở tầng lưu trữ thì **không** nằm trong tiêu chí này
  — đó là hệ quả trực tiếp của việc bỏ checksum (xem Out of Scope).
- **SC-007**: Người dùng đã đăng nhập tải được tệp cài đặt chỉ bằng tham chiếu tệp lấy từ truy vấn
  bản hiện hành, không cần Admin gửi tệp thủ công qua kênh khác.

## Assumptions

- Tệp cài đặt được tải lên trước bằng chức năng quản lý tệp sẵn có; **việc tải tệp không thuộc
  phạm vi spec này**, Admin chỉ truyền tham chiếu tệp vào.
- Studio tự so sánh số phiên bản ở phía ứng dụng để quyết định có nhắc cập nhật hay không; hệ thống
  chỉ công bố bản hiệu lực, không tính toán "có bản mới hay không" giúp client.
- Không có cờ "cập nhật bắt buộc", không tách kênh beta/stable, không phân biệt kiến trúc CPU.
- Ràng buộc duy nhất của số phiên bản áp dụng cho **cả bản đã xoá mềm**: một số phiên bản đã dùng
  thì không tái sử dụng. Điều này không làm Admin bị kẹt, vì không có đường nào trong tính năng xoá
  mềm một bản phát hành (không có chức năng xoá — xem Out of Scope), nên xung đột kiểu "bản vô hình
  chiếm mất số phiên bản" chỉ xảy ra sau can thiệp thủ công vào dữ liệu. Nếu sau này bổ sung chức
  năng xoá bản phát hành thì phải xem lại ràng buộc này cùng lúc.
- Phân quyền đi theo cơ chế seed sẵn có: seed quét controller và gán toàn bộ route cho vai trò
  Admin. Seed **không** bỏ qua route công khai nên truy vấn bản hiện hành cũng có một bản ghi
  quyền; bản ghi đó vô hại vì route công khai không đi qua bước kiểm quyền.
- Hệ thống **không** kiểm tra kiểu nội dung của tệp được trỏ tới; Admin chịu trách nhiệm chọn đúng
  tệp cài đặt. Giữ nguyên hành vi Launcher (Constitution VI).
- Không cache câu trả lời của truy vấn bản hiện hành trong phạm vi spec này — giữ nguyên hành vi
  hiện tại của Launcher; nếu lượng gọi tăng, xử lý trong một thay đổi riêng.

## Out of Scope

- Tải tệp cài đặt lên kho tệp (đã có sẵn, dùng lại nguyên trạng).
- Giá trị băm, chữ ký số, hay code signing của tệp cài đặt — xem Clarifications, đã cố ý loại bỏ.
  Kéo theo: hệ thống không phát hiện được tệp tải về bị thiếu byte, tệp hỏng ở tầng lưu trữ, hay
  tệp bị thay mà không qua API.
- Tách bản phát hành theo hệ điều hành, kiến trúc CPU, hay kênh phát hành.
- Cập nhật kiểu delta/differential; Studio tải trọn bộ tệp cài đặt.
- Xoá bản phát hành qua API (Launcher cũng không có); dọn dữ liệu làm thủ công nếu cần.
- Thống kê lượt tải, tỉ lệ người dùng đã lên bản mới.
- Phiên bản tối thiểu bắt buộc / chặn Studio quá cũ kết nối hệ thống.
- Sửa `launcher-release` theo các cải tiến của spec này (semver nghiêm ngặt, unique số phiên bản,
  trần kích thước trang, thao tác gỡ hiệu lực) — cố ý để lại một thay đổi riêng vì Launcher đang
  chạy production.
- Mở đường tải tệp cài đặt cho người chưa đăng nhập — xem Clarifications, đã chốt là giữ như
  Launcher. Nếu sau này muốn Studio tự cập nhật trước khi đăng nhập thì cần một thay đổi riêng.
- Giới hạn tần suất gọi cho truy vấn công khai: hệ thống hiện chưa có cơ chế này ở bất kỳ endpoint
  nào, spec này không thêm.
- Ngăn xoá tệp cài đặt đang được một bản phát hành sử dụng — thuộc chức năng quản lý tệp, cần thay
  đổi riêng; xem Edge Cases.

## Dependencies

- Kho tệp tĩnh sẵn có (bảng tệp + lưu trữ đối tượng) để tham chiếu tệp cài đặt và lấy tên, kiểu nội
  dung, dung lượng.
- Cơ chế seed permission sẵn có của hệ thống — xem FR-017 và Constitution Nguyên tắc II.
- Cơ chế khoá phân tán và transaction sẵn có, để FR-006/FR-007 thực hiện được.
