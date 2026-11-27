# Feature Specification: Tạo đơn rút tiền cho nhà phát hành

**Feature Branch**: `feat/withdrawal-request` (tách từ `staging`)

**Created**: 2026-11-27

**Status**: Draft

**Input**: User description: "Tạo đơn rút tiền cho publisher (withdrawal request — lát cắt tạo đơn, chưa có duyệt/chi tiền)"

---

## Bối cảnh

Đây là **phase 4** của module payout. Ba phase trước đã lên production:

| Phase | Nội dung | Trạng thái |
|---|---|---|
| 1 | `SystemSetting` — kho cấu hình runtime (spec 009) | Đã lên production |
| 2 | Chia hoa hồng giữa sàn và nhà phát hành (spec 010) | Đã lên production |
| 3 | Sổ cái `WalletTransaction` + tài khoản tiền của sàn (spec 011) | Đã lên production |
| **4** | **Rút tiền về ngân hàng** | **Spec này** |

Hiện tại nhà phát hành được cộng tiền vào ví **ngay lúc khách mua hàng**, nhưng **không có
đường nào đưa tiền đó ra khỏi hệ thống**. Spec này mở đường đó.

Đây là lần đầu tiên tiền **rời khỏi** hệ thống. Mọi phép đối soát dòng tiền hiện có đều được
viết với giả định "tiền chỉ vào, không ra" và phải được cập nhật trong phase này.

**Phạm vi là lát cắt TẠO ĐƠN.** Nhà phát hành tạo đơn, xem đơn, huỷ đơn. Việc quản trị viên
duyệt / từ chối / đánh dấu đã chi tiền là một lát cắt riêng sau này.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Nhà phát hành tạo đơn rút tiền (Priority: P1)

Một nhà phát hành đã bán được hàng và có tiền trong ví. Họ muốn chuyển số tiền đó về tài khoản
ngân hàng của mình. Họ nhập số tiền muốn rút và thông tin tài khoản ngân hàng nhận tiền, rồi
gửi yêu cầu. Số dư ví giảm ngay lập tức, và đơn nằm ở trạng thái chờ quản trị viên xử lý.

**Why this priority**: Đây là toàn bộ lý do spec này tồn tại. Không có nó thì tiền nhà phát
hành kiếm được bị kẹt vĩnh viễn trong hệ thống. Hai user story còn lại chỉ có nghĩa khi đã có
đơn để xem và để huỷ.

**Independent Test**: Đăng nhập bằng một tài khoản nhà phát hành có số dư, gọi API tạo đơn,
rồi kiểm tra ba thứ: đơn được tạo ở trạng thái chờ duyệt, số dư ví giảm đúng bằng số tiền rút,
và sổ cái có đúng một bút toán ghi nhận khoản giảm đó.

**Acceptance Scenarios**:

1. **Given** một nhà phát hành đang hoạt động có số dư 500.000đ và chưa từng tạo đơn rút tiền,
   **When** họ tạo đơn rút 200.000đ kèm thông tin tài khoản ngân hàng hợp lệ,
   **Then** đơn được tạo ở trạng thái chờ duyệt, số dư còn 300.000đ, và sổ cái có một bút toán
   ghi khoản giảm 200.000đ gắn với đơn đó.

2. **Given** một nhà phát hành có số dư 50.000đ,
   **When** họ tạo đơn rút 200.000đ,
   **Then** hệ thống từ chối vì không đủ số dư, số dư giữ nguyên 50.000đ, và không có bút toán
   nào được ghi.

3. **Given** mức rút tối thiểu đang là 100.000đ,
   **When** nhà phát hành tạo đơn rút 50.000đ,
   **Then** hệ thống từ chối và nói rõ mức tối thiểu, không đụng tới số dư.

4. **Given** một người dùng thông thường (không phải nhà phát hành) có số dư 500.000đ,
   **When** họ gọi API tạo đơn rút tiền,
   **Then** hệ thống từ chối vì họ không phải nhà phát hành, số dư giữ nguyên.

5. **Given** một nhà phát hành **đang bị khoá**,
   **When** họ tạo đơn rút tiền,
   **Then** hệ thống từ chối vì tài khoản nhà phát hành bị khoá.

6. **Given** một nhà phát hành vừa tạo đơn rút tiền cách đây 3 giờ,
   **When** họ tạo đơn rút tiền tiếp,
   **Then** hệ thống từ chối và cho biết thời điểm sớm nhất họ được tạo đơn tiếp.

7. **Given** một nhà phát hành tạo đơn rút tiền và request bị lặp lại do mạng chập chờn
   (cùng khoá chống lặp, cùng nội dung),
   **When** request thứ hai tới,
   **Then** hệ thống trả về đúng đơn đã tạo ở lần đầu, số dư chỉ bị trừ **một lần**, sổ cái
   chỉ có **một** bút toán.

---

### User Story 2 - Nhà phát hành xem lại các đơn rút tiền của mình (Priority: P2)

Sau khi tạo đơn, nhà phát hành cần biết đơn của mình đang ở đâu: còn chờ duyệt, đã được duyệt,
đã chi tiền, hay bị từ chối. Họ xem danh sách đơn của mình theo thứ tự mới nhất trước, và xem
được chi tiết từng đơn kèm thông tin tài khoản ngân hàng đã khai.

**Why this priority**: Không có nó thì nhà phát hành tạo đơn xong rơi vào im lặng — chỉ thấy
số dư giảm mà không biết tiền đang ở đâu. Nhưng nó không chặn luồng tiền, nên xếp sau P1.

**Independent Test**: Tạo vài đơn rồi gọi API danh sách; kiểm tra phân trang đúng, thứ tự mới
nhất trước, và không có đơn của nhà phát hành khác lọt vào.

**Acceptance Scenarios**:

1. **Given** một nhà phát hành đã tạo 3 đơn rút tiền,
   **When** họ xem danh sách đơn của mình,
   **Then** thấy đúng 3 đơn, mới nhất xếp trước, mỗi đơn kèm số tiền, trạng thái, thông tin
   ngân hàng và thời điểm tạo.

2. **Given** nhà phát hành A và nhà phát hành B đều có đơn rút tiền,
   **When** A xem danh sách của mình,
   **Then** không có đơn nào của B xuất hiện.

3. **Given** nhà phát hành A có một đơn rút tiền,
   **When** nhà phát hành B xem chi tiết đơn đó bằng mã đơn,
   **Then** hệ thống trả lời **giống hệt** như khi mã đơn không tồn tại — không tiết lộ rằng
   đơn đó có thật và thuộc về người khác.

---

### User Story 3 - Nhà phát hành huỷ đơn đang chờ duyệt (Priority: P3)

Nhà phát hành đổi ý, hoặc phát hiện mình nhập sai thông tin tài khoản ngân hàng. Khi đơn còn
đang chờ duyệt, họ tự huỷ được. Tiền quay trở lại ví ngay, và sổ cái ghi nhận khoản hoàn đó
thành một bút toán riêng.

**Why this priority**: Giảm việc cho quản trị viên và cho nhà phát hành quyền sửa sai của chính
mình. Nhưng nếu thiếu, quản trị viên vẫn xử lý tay được ở lát cắt sau, nên đây là P3.

**Independent Test**: Tạo đơn, huỷ đơn, rồi kiểm tra số dư đã trở về đúng mức ban đầu và sổ cái
có đủ **hai** bút toán ngược chiều nhau gắn cùng một đơn.

**Acceptance Scenarios**:

1. **Given** một đơn rút 200.000đ đang chờ duyệt và số dư ví hiện là 300.000đ,
   **When** nhà phát hành huỷ đơn đó,
   **Then** đơn chuyển sang trạng thái đã huỷ, số dư trở lại 500.000đ, và sổ cái có thêm một
   bút toán hoàn tiền gắn với đơn đó.

2. **Given** một đơn đã bị huỷ,
   **When** nhà phát hành huỷ lại đơn đó lần nữa,
   **Then** hệ thống từ chối, số dư **không** được cộng thêm lần thứ hai.

3. **Given** một đơn đã được quản trị viên duyệt hoặc đã chi tiền,
   **When** nhà phát hành huỷ đơn đó,
   **Then** hệ thống từ chối vì đơn không còn ở trạng thái chờ duyệt.

4. **Given** nhà phát hành A có một đơn đang chờ duyệt,
   **When** nhà phát hành B huỷ đơn đó,
   **Then** hệ thống trả lời giống như đơn không tồn tại, đơn của A không bị đụng tới.

5. **Given** nhà phát hành tạo đơn lúc 10:00 rồi huỷ đơn đó lúc 10:05,
   **When** họ tạo đơn mới lúc 11:00,
   **Then** hệ thống **vẫn từ chối** — đơn đã huỷ vẫn tính vào mốc chờ 24 giờ.

---

### Edge Cases

- **Số tiền bằng 0 hoặc âm**: bị từ chối ngay ở tầng xác thực dữ liệu, không chạm tới ví.
- **Số tiền vượt trần số nguyên lớn**: bị từ chối thành lỗi dữ liệu đầu vào, **không** được để
  tràn xuống tầng lưu trữ rồi thành lỗi hệ thống. Đây là lỗi đã xảy ra thật ở spec 011.
- **Rút đúng bằng toàn bộ số dư**: được phép; số dư về 0, không vi phạm ràng buộc không-âm.
- **Hai request tạo đơn chạy song song với tổng tiền vượt số dư**: đúng một request thành công,
  request còn lại bị từ chối vì không đủ số dư. Không bao giờ cả hai cùng qua.
- **Hai request tạo đơn chạy song song, cả hai đều qua mốc 24 giờ**: đúng một request thành công.
  Mốc 24 giờ không được phép bị lách bằng cách gửi đồng thời.
- **Hai request huỷ cùng một đơn chạy song song**: đúng một request hoàn tiền; request còn lại
  nhận câu trả lời nghiệp vụ "đơn không còn ở trạng thái chờ duyệt", **không** phải một lỗi hệ
  thống. Hai request phải xếp hàng chứ không chạy chồng nhau (FR-025a).
- **Khoá chống lặp được dùng lại cho một đơn khác nội dung**: bị từ chối, không tạo đơn mới.
- **Nhà phát hành bị khoá sau khi đã tạo đơn**: đơn đã tạo giữ nguyên; họ không tạo được đơn
  mới. Việc chi tiền cho đơn cũ là quyết định của quản trị viên ở lát cắt sau.
- **Hồ sơ nhà phát hành bị xoá mềm**: không tạo được đơn.
- **Mức rút tối thiểu chưa được cấu hình hoặc giá trị không đọc được**: hệ thống từ chối tạo đơn
  và báo lỗi cấu hình, **không** tự rơi về một con số mặc định ẩn trong mã nguồn.
- **Quản trị viên đổi mức tối thiểu khi đang có đơn chờ duyệt**: đơn cũ không bị ảnh hưởng; mức
  mới chỉ áp cho đơn tạo sau đó.
- **Đơn rút tiền đầu tiên của một nhà phát hành**: không có đơn trước nên mốc 24 giờ không áp dụng.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Ai được rút tiền

- **FR-001**: Hệ thống PHẢI chỉ cho **nhà phát hành** tạo đơn rút tiền. Người dùng không có tư
  cách nhà phát hành PHẢI bị từ chối.
- **FR-002**: Hệ thống PHẢI dùng lại đúng bộ điều kiện "nhà phát hành đang hoạt động" mà các
  chức năng nhà phát hành khác đang dùng: tài khoản người dùng đang hoạt động, có hồ sơ nhà phát
  hành chưa bị xoá, không bị khoá, còn vai trò nhà phát hành, và đã chấp nhận điều khoản. Không
  được định nghĩa lại điều kiện này ở chỗ khác.
- **FR-003**: Nhà phát hành **đang bị khoá** PHẢI không tạo được đơn rút tiền.

#### Tiền và số dư

- **FR-004**: Hệ thống PHẢI cho rút tiền **bất kể nguồn gốc** của số dư — tiền từ bán hàng, tiền
  quản trị viên cộng, hay tiền nạp vào đều rút được. Hệ thống KHÔNG tách sổ theo nguồn.
- **FR-005**: Hệ thống PHẢI trừ số dư ví **ngay tại thời điểm tạo đơn**, không chờ duyệt.
- **FR-006**: Hệ thống PHẢI từ chối đơn có số tiền lớn hơn số dư hiện có, và KHÔNG được để số dư
  xuống dưới 0 trong bất kỳ tình huống nào.
- **FR-007**: Việc kiểm tra số dư và việc trừ số dư PHẢI là một thao tác không thể chen ngang:
  hai yêu cầu chạy song song KHÔNG bao giờ được phép cùng qua khi tổng tiền vượt số dư.
- **FR-008**: Trường hợp không đủ số dư PHẢI là một câu trả lời nghiệp vụ rõ ràng cho người dùng,
  KHÔNG phải một lỗi hệ thống.
- **FR-009**: Hệ thống KHÔNG thu phí rút tiền. Số tiền nhà phát hành nhận được bằng đúng số tiền
  bị trừ khỏi ví.

#### Hạn mức và nhịp rút

- **FR-010**: Hệ thống PHẢI có **mức rút tối thiểu**, và PHẢI từ chối đơn dưới mức đó.
- **FR-011**: Mức rút tối thiểu PHẢI được lưu trong kho cấu hình runtime để quản trị viên đổi
  được mà không cần triển khai lại mã nguồn. Giá trị khởi tạo là **100.000đ**.
- **FR-012**: Nếu mức rút tối thiểu **chưa được cấu hình** hoặc **giá trị lưu không đúng định dạng**,
  hệ thống PHẢI từ chối tạo đơn và báo đây là lỗi cấu hình. KHÔNG được rơi về một giá trị mặc định
  ẩn trong mã nguồn.
- **FR-012a**: Lỗi **hạ tầng** xảy ra lúc đọc cấu hình — hết thời gian chờ khoá, mất kết nối — PHẢI
  giữ nguyên hình dạng lỗi của chính nó, KHÔNG được biến thành "lỗi cấu hình". Biến nó thành lỗi
  cấu hình sẽ chỉ người vận hành đi sửa một dòng cấu hình hoàn toàn bình thường. Luồng mua hàng đã
  vấp và đã sửa đúng lỗi này; tính năng này PHẢI theo cùng cách xử lý.
- **FR-013**: Hệ thống PHẢI buộc nhà phát hành chờ **đủ 24 giờ** kể từ **thời điểm tạo** của đơn
  rút tiền gần nhất mới được tạo đơn tiếp. Tính bằng 24 giờ thật, KHÔNG phải tính theo ngày lịch.
  Mốc neo luôn là lúc đơn được tạo, KHÔNG phải lúc đơn được duyệt, bị từ chối hay bị huỷ.
- **FR-014**: Mốc 24 giờ PHẢI tính trên **mọi** đơn đã tạo, bất kể kết quả — kể cả đơn đã bị huỷ
  và đơn bị từ chối.
- **FR-015**: Khi từ chối vì chưa đủ 24 giờ, hệ thống PHẢI cho biết **thời điểm sớm nhất** nhà
  phát hành được tạo đơn tiếp.
- **FR-016**: Việc kiểm tra mốc 24 giờ PHẢI chống được yêu cầu song song: hai yêu cầu gửi cùng lúc
  KHÔNG bao giờ được phép cùng qua.
- **FR-016a**: Việc nhận diện yêu cầu lặp (FR-034) PHẢI chạy **TRƯỚC** phép kiểm mốc 24 giờ. Một
  yêu cầu bị gửi lại do mạng chập chờn PHẢI nhận lại đúng đơn đã tạo, KHÔNG được bị từ chối vì
  "chưa đủ 24 giờ" — nếu không, mọi lần thử lại trong vòng 24 giờ đều hỏng, mà thử lại là đúng
  thứ cơ chế chống lặp sinh ra để phục vụ. Phép kiểm này PHẢI chạy lại một lần nữa sau khi đã
  giành được khoá, vì yêu cầu thua cuộc trong một cặp chạy song song thường vấp phải quy tắc
  nghiệp vụ trước khi vấp vào chính khoá chống lặp.
- **FR-017**: Hệ thống KHÔNG giới hạn số đơn đang chờ duyệt mà một nhà phát hành có thể có.

#### Thông tin tài khoản ngân hàng

- **FR-018**: Mỗi đơn rút tiền PHẢI mang **ba** thông tin ngân hàng do nhà phát hành nhập: số tài
  khoản, tên ngân hàng, tên chủ tài khoản. Cả ba đều bắt buộc.
- **FR-019**: Thông tin ngân hàng PHẢI được lưu **trên chính đơn đó**, không phải tham chiếu tới
  một nơi lưu dùng chung. Kiểm chứng trong lát cắt này: tạo hai đơn với thông tin ngân hàng khác
  nhau, cả hai đơn PHẢI giữ nguyên thông tin riêng của mình, và sửa hồ sơ nhà phát hành PHẢI không
  làm đổi thông tin ngân hàng trên bất kỳ đơn nào.

  **Vì sao ghi thành yêu cầu dù hiện chưa có nơi lưu dùng chung**: nếu sau này thêm chức năng lưu
  sẵn tài khoản ngân hàng trên hồ sơ, yêu cầu này là thứ ngăn người hiện thực biến đơn cũ thành
  tham chiếu — điều sẽ làm chứng từ của đơn đã chi thay đổi theo hồ sơ.
- **FR-020**: Hệ thống KHÔNG ép tên chủ tài khoản phải trùng tên nhà phát hành. Thông tin được lưu
  nguyên văn để quản trị viên đối chiếu khi duyệt.

#### Vòng đời đơn

- **FR-021**: Đơn mới tạo PHẢI ở trạng thái **chờ duyệt**.
- **FR-022**: Hệ thống PHẢI khai sẵn đầy đủ tập trạng thái của đơn — chờ duyệt, đã duyệt, bị từ
  chối, đã chi tiền, đã huỷ — ngay từ lần đầu, dù lát cắt này chỉ sinh ra đúng hai trạng thái:
  **chờ duyệt** và **đã huỷ**.
- **FR-023**: Nhà phát hành PHẢI huỷ được đơn của **chính mình** khi đơn còn ở trạng thái chờ duyệt.
- **FR-024**: Huỷ đơn PHẢI cộng trả **đúng** số tiền đã trừ về ví nhà phát hành.
- **FR-025**: Một đơn PHẢI không bao giờ được hoàn tiền quá một lần, kể cả khi có nhiều yêu cầu
  huỷ chạy song song.
- **FR-025a**: Hai yêu cầu huỷ cùng một đơn chạy song song PHẢI được **xếp hàng** chứ không chạy
  chồng nhau: yêu cầu thứ hai chỉ được đọc trạng thái đơn sau khi yêu cầu thứ nhất đã xong, và vì
  thế nhận được câu trả lời nghiệp vụ "đơn không còn ở trạng thái chờ duyệt" (FR-026). Chốt chặn ở
  tầng dữ liệu là **lớp phòng thủ thứ hai** cho trường hợp lập trình sai, KHÔNG phải là cơ chế
  chính — nếu để nó bắt thì người dùng nhận một lỗi hệ thống, vi phạm SC-009.
- **FR-026**: Đơn không còn ở trạng thái chờ duyệt PHẢI không huỷ được.
- **FR-027**: Mỗi đơn PHẢI ghi lại nơi để quản trị viên nhập **mã giao dịch ngân hàng** sau khi
  chuyển khoản tay. Lát cắt này chỉ khai chỗ chứa, chưa dùng tới.

#### Sổ cái

- **FR-028**: Mỗi lần tạo đơn rút tiền PHẢI để lại **đúng một** bút toán ghi khoản giảm trên ví
  nhà phát hành, gắn với đơn đó.
- **FR-029**: Mỗi lần hoàn tiền PHẢI để lại **đúng một** bút toán ghi khoản cộng trên ví nhà phát
  hành, gắn với đơn đó, và thuộc một **loại riêng biệt** với bút toán ở FR-028. Lát cắt này chỉ
  **hiện thực** đường hoàn tiền do nhà phát hành tự huỷ; đường hoàn tiền do quản trị viên từ chối
  thuộc lát cắt sau, nhưng cấu trúc dữ liệu PHẢI được thiết kế để nhận cả hai mà không cần sửa lại.
- **FR-030**: Việc đổi số dư và việc ghi sổ PHẢI cùng thành công hoặc cùng không. KHÔNG bao giờ
  tồn tại trạng thái số dư đã đổi mà sổ cái không có dòng tương ứng, hoặc ngược lại.
- **FR-031**: Ràng buộc "phải ghi rõ ai thực hiện và vì sao" PHẢI áp dụng **có điều kiện**, không
  áp cứng cho cả loại bút toán hoàn tiền: bút toán do quản trị viên từ chối phải có, bút toán do
  nhà phát hành tự huỷ KHÔNG có quản trị viên nào nên không thể có. Lát cắt này chỉ sinh ra loại
  thứ hai, nhưng ràng buộc phải được viết đúng ngay từ đầu — viết áp cứng sẽ chặn chính đường tự
  huỷ đang làm.
- **FR-032**: Phép đối soát dòng tiền của hệ thống PHẢI phân biệt **hai** trạng thái khác nhau của
  tiền rút, và KHÔNG được gộp chúng làm một:
  - **Tiền đang chờ chi** — đơn đã tạo nhưng chưa chi thật. Số tiền này **đã rời khỏi ví** nhà phát
    hành nhưng **vẫn nằm trong tài khoản ngân hàng của công ty**. Nó vẫn là một khoản **nợ** của hệ
    thống, chỉ đổi hình thức.
  - **Tiền đã chi thật** — đơn đã được đánh dấu chi tiền. Đây mới là lúc tiền thật sự rời khỏi hệ thống.

  **Vì sao bắt buộc tách**: trừ ví ngay lúc tạo đơn (FR-005) làm khoản nợ với người dùng giảm xuống
  trong khi công ty vẫn đang giữ nguyên số tiền mặt đó. Coi lúc tạo đơn là lúc tiền rời hệ thống sẽ
  làm sổ sách **báo thiếu** số tiền công ty đang thực giữ, đúng bằng tổng các đơn chưa chi. Một đơn
  nằm chờ một tuần nghĩa là sổ sách sai suốt một tuần.
- **FR-032a**: Sau khi cập nhật, phép đối soát PHẢI vẫn đúng với dữ liệu production hiện có (khi
  chưa có đơn rút tiền nào, hai túi mới đều bằng 0 nên đẳng thức phải quy về đúng dạng cũ), và PHẢI
  vẫn đúng sau mỗi bước chuyển trạng thái: tạo đơn, huỷ đơn, và chi tiền.

#### Chống lặp và an toàn

- **FR-033**: Hệ thống PHẢI dùng cơ chế khoá chống lặp giống luồng mua hàng, để một yêu cầu bị gửi
  lại do mạng không tạo ra hai đơn.
- **FR-034**: Gửi lại cùng một khoá chống lặp với cùng nội dung PHẢI trả về đúng đơn đã tạo lần
  đầu, và số dư chỉ bị trừ một lần. **"Cùng nội dung" nghĩa là khớp cả bốn thứ**: số tiền, số tài
  khoản, tên ngân hàng, tên chủ tài khoản.
- **FR-035**: Dùng lại một khoá chống lặp mà **bất kỳ** thứ nào trong bốn thứ trên khác đi PHẢI bị
  từ chối, và KHÔNG được tạo đơn mới. Đặc biệt: cùng số tiền nhưng khác số tài khoản là tình huống
  nguy hiểm nhất — im lặng trả về đơn cũ sẽ khiến tiền đi tới tài khoản mà người dùng tưởng đã đổi.
- **FR-036**: Nhà phát hành PHẢI chỉ xem được đơn của chính mình. Truy cập đơn của người khác PHẢI
  trả lời **giống hệt** như khi đơn không tồn tại.
- **FR-037**: Danh tính nhà phát hành PHẢI luôn lấy từ phiên đăng nhập, KHÔNG bao giờ từ dữ liệu
  người gọi gửi lên.
- **FR-038**: Ba route mới PHẢI viết theo đúng quy ước mà công cụ quét route nhận ra được, để bản
  ghi phân quyền sinh ra tự động trong lần chạy seed kế tiếp. KHÔNG cần sửa tay danh sách route
  nào — công cụ seed tự đọc mã nguồn.
- **FR-038a**: Lần triển khai của tính năng này **KHÔNG bắt buộc phải chạy seed phân quyền**. Ba
  route đã bỏ qua bước so khớp quyền (FR-039) nên chúng chạy được mà không cần bản ghi nào.

  **Đây là một ràng buộc an toàn, không phải sự lười biếng**: thao tác seed phân quyền kết thúc
  bằng việc xoá cache phân quyền, mà cache đó **không có hạn dùng** nên đang che đi mọi khoản cấp
  quyền đã mất của các vai trò không phải quản trị viên. Ngày 2026-11-23 chính việc xoá cache này
  đã làm toàn bộ khách hàng không nạp được tiền. Nếu vì lý do khác mà buộc phải chạy, PHẢI kiểm
  trước xem có khoản cấp quyền nào của vai trò không phải quản trị viên đang bị xoá mềm hay không.
- **FR-039**: Ba route của tính năng này PHẢI theo đúng hình dạng mà trang doanh thu nhà phát
  hành đang dùng: **bỏ qua việc so khớp quyền theo vai trò**, và thay vào đó service tự lọc theo
  danh tính lấy từ phiên đăng nhập. Bản ghi phân quyền vẫn được tạo để thoả FR-038, nhưng không
  phải là thứ chặn truy cập.

  **Lý do**: việc cấp quyền hiện chỉ sinh ra cho quản trị viên; một route gác quyền theo vai trò
  sẽ từ chối **mọi** nhà phát hành cho tới khi có người sửa dữ liệu bằng tay. Tư cách "nhà phát
  hành đang hoạt động" đã được kiểm bằng FR-002, và quyền sở hữu đơn đã được kiểm bằng FR-036 —
  hai chốt đó mới là thứ bảo vệ tính năng này, không phải bảng phân quyền.

---

### Key Entities

- **Đơn rút tiền (WithdrawalRequest)**: một lần nhà phát hành yêu cầu chuyển tiền từ ví về tài
  khoản ngân hàng. Mang: chủ đơn, số tiền, trạng thái, bản chụp ba thông tin ngân hàng, khoá chống
  lặp, chỗ ghi mã giao dịch ngân hàng, lý do từ chối, các mốc thời gian, và người xử lý.

- **Ví nhà phát hành (Profile.balance — đã có)**: số dư hiện tại. Spec này thêm **một đường làm
  giảm** số dư và **một đường làm tăng** lại khi hoàn.

- **Bút toán sổ cái (WalletTransaction — đã có)**: spec này thêm **hai loại** bút toán mới — một
  cho khoản rút, một cho khoản hoàn — và thêm đường nối từ bút toán về đơn rút tiền.

- **Mức rút tối thiểu (SystemSetting — đã có)**: một khoá cấu hình mới, quản trị viên đổi được qua
  API sẵn có.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Nhà phát hành có đủ số dư tạo được đơn rút tiền trong **một** thao tác, và thấy số
  dư cập nhật ngay trong câu trả lời của chính thao tác đó.
- **SC-002**: Tổng số tiền của các đơn **chưa được hoàn** (tức là mọi đơn trừ đơn đã huỷ và đơn
  bị từ chối) luôn **bằng đúng** tổng khoản đã trừ khỏi ví trừ đi tổng khoản đã hoàn lại — kiểm
  được bằng một phép truy vấn, không cần tin vào mã nguồn.
- **SC-003**: Không ví nào xuống dưới 0 trong mọi kịch bản thử, kể cả khi gửi 10 yêu cầu rút tiền
  song song từ cùng một ví có số dư chỉ đủ cho một yêu cầu.
- **SC-004**: Trong thử nghiệm gửi song song, **đúng một** yêu cầu thành công ở cả ba tình huống:
  vượt số dư, chưa đủ 24 giờ, và huỷ trùng đơn.
- **SC-005**: Mọi thay đổi số dư do tính năng này gây ra đều có bút toán tương ứng — số bút toán
  khớp 100% với số lần số dư đổi, không thừa không thiếu.
- **SC-006**: Phép đối soát dòng tiền sau khi cập nhật vẫn cho kết quả đúng trên dữ liệu production
  hiện có (chưa có đơn rút tiền nào → phải quy về đúng dạng cũ), và vẫn đúng sau mỗi bước chuyển
  trạng thái: tạo đơn, huỷ đơn, chi tiền.
- **SC-006a**: Với một đơn đang chờ chi, báo cáo dòng tiền PHẢI vẫn thể hiện số tiền đó là **khoản
  công ty đang giữ và còn nợ**, không phải khoản đã chi đi. Kiểm bằng cách: tạo một đơn rút tiền
  rồi đối chiếu tổng tài sản theo sổ sách với số tiền công ty thực giữ — hai con số phải không đổi
  so với trước khi tạo đơn.
- **SC-007**: Người dùng không phải nhà phát hành và nhà phát hành bị khoá đều bị từ chối ở **100%**
  số lần thử, với thông báo nói rõ lý do.
- **SC-008**: Nhà phát hành không bao giờ nhìn thấy đơn của nhà phát hành khác, và không phân biệt
  được "đơn của người khác" với "đơn không tồn tại" qua câu trả lời của hệ thống.
- **SC-009**: Mọi tình huống bị từ chối vì lý do nghiệp vụ (thiếu tiền, dưới mức tối thiểu, chưa đủ
  24 giờ, đơn sai trạng thái) đều trả về lỗi nghiệp vụ rõ ràng — **không có trường hợp nào** rơi
  thành lỗi hệ thống.

---

## Assumptions

- **Nhà phát hành đã tồn tại và có cơ chế xác định tư cách.** Spec này dùng lại nguyên bộ điều kiện
  đó, không xây mới.
- **Ví và sổ cái đã hoạt động đúng.** Spec này chỉ thêm hai loại bút toán và một đường trừ số dư.
- **Quản trị viên chuyển khoản tay.** Hệ thống không gọi API chuyển tiền của bên thứ ba nào. Do đó
  không cần thêm khoá bí mật, không cần webhook chiều ra.
- **Tiền tính bằng đồng, số nguyên.** Không có số lẻ thập phân, giống toàn bộ phần còn lại của hệ thống.
- **Không có hạn mức tối đa** cho mỗi đơn hay mỗi ngày ở phase này. Mức tối thiểu cộng với nhịp 24
  giờ đã đủ cho quy mô hiện tại.
- **Không xác minh danh tính (KYC)** trước lần rút đầu tiên. Việc chi tiền đã qua tay quản trị viên
  duyệt, nên đó là chốt chặn.
- **Không gửi thông báo hay email** khi đơn được tạo hay đổi trạng thái.
- **Tiền nạp vào cũng rút ra được.** Chủ repo đã được nêu rõ hệ quả: một nhà phát hành nạp tiền rồi
  rút ra là đường đi hợp lệ theo thiết kế này. Chấp nhận ở phase này vì việc chi tiền vẫn qua quản
  trị viên duyệt.
- **Hệ quả đã được chấp nhận của FR-014**: nhà phát hành nhập sai thông tin ngân hàng rồi tự huỷ
  đơn sẽ bị khoá trọn 24 giờ. Nghĩa là chức năng tự huỷ gần như không dùng được để sửa lỗi đánh máy;
  nó chỉ còn ý nghĩa khi nhà phát hành đổi ý không muốn rút nữa. Chủ repo đã chọn phương án này sau
  khi đánh đổi được nêu rõ.

---

## Out of Scope

Những thứ sau **không** thuộc spec này:

- **Quản trị viên duyệt, từ chối, đánh dấu đã chi tiền** — lát cắt tiếp theo. Spec này khai sẵn
  trạng thái và chỗ chứa mã giao dịch để lát cắt đó không phải đổi cấu trúc dữ liệu.
- **Quản trị viên xem danh sách đơn chờ duyệt** — cùng lát cắt với việc duyệt.
- **Gọi API chuyển tiền tự động** — đã chốt là chuyển khoản tay.
- **Sửa thông tin ngân hàng của đơn đang chờ duyệt.** Đây là cách rẻ nhất để chữa hệ quả của
  FR-014 nếu sau này thấy phiền, nhưng chưa làm bây giờ.
- **Lưu sẵn tài khoản ngân hàng trên hồ sơ nhà phát hành** và chọn khi tạo đơn.
- **Phí rút tiền.** Nếu sau này thu phí thì đơn phải mang ba con số thay vì một, và phí phải thành
  một bút toán riêng vào ví sàn — đây là thay đổi cấu trúc dữ liệu, không phải thêm một trường.
- **Hạn mức tối đa** mỗi đơn hoặc mỗi ngày.
- **Xác minh danh tính (KYC)**.
- **Thông báo, email, webhook** khi đơn đổi trạng thái.
- **Quản trị viên trừ tiền trực tiếp khỏi ví người dùng** — vẫn ngoài phạm vi như ở spec 011.
- **Rút lợi nhuận từ tài khoản của sàn về tài khoản công ty.** Đây là đường tiền khác hẳn, dù nghe
  giống.
- **Giữ tiền trong thời gian bảo hành (escrow).** Là spec riêng. Spec này không cản: escrow đổi
  **lúc nào** tiền vào ví nhà phát hành, còn spec này lo **cách** tiền rời ví — hai việc độc lập.
  Lưu ý đã nêu và chủ repo chấp nhận: làm rút tiền trước escrow nghĩa là nhà phát hành rút được
  tiền của đơn hàng còn trong hạn bảo hành.
- **Tách riêng "số dư rút được" khỏi "số dư nạp vào".** Đã cân nhắc và bỏ — xem Assumptions.
- **Xử lý đơn đang chờ khi nhà phát hành bị xoá mềm.** Tiền đã bị trừ khỏi ví nhưng hồ sơ không
  còn, nên phép đối soát ví (vốn lọc bỏ hồ sơ đã xoá) sẽ không thấy khoản đó. Tình huống này chưa
  có đường xử lý và **cố ý để ngoài phạm vi**; nếu xảy ra thì quản trị viên xử lý tay. Ghi lại ở
  đây để người làm lát cắt duyệt đơn biết nó tồn tại chứ không phát hiện lại từ đầu.

---

## Dependencies

- **Spec 009 (SystemSetting)** — cần cho mức rút tối thiểu. Đã lên production.
- **Spec 011 (Sổ cái ví)** — cần cho việc ghi bút toán và cho ràng buộc số dư không-âm. Đã lên
  production. Ràng buộc `balance >= 0` là thứ làm cho FR-006 trở thành bảo đảm ở tầng dữ liệu
  chứ không chỉ là một phép kiểm trong mã nguồn.
- **Cơ chế nhà phát hành** (hồ sơ, trạng thái khoá, điều khoản) — đã có.
- **Cơ chế khoá chống lặp của luồng mua hàng** — đã có, dùng lại.
