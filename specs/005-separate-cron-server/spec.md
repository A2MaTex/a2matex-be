# Feature Specification: Tách job định kỳ ra dịch vụ riêng

**Feature Branch**: `ffeature/separate-cron-server` (thư mục spec: `specs/005-separate-cron-server`)

**Created**: 2026-10-27

**Status**: Draft

**Input**: User description: "Tách cron ra một server riêng chạy port riêng, vẫn dùng chung module với backend. Luồng presigned stream lên S3 của Nga cần chạy cron. Tách sao cho cron server clean để thêm schedule cho dễ. Cron expression dùng qua env config, chưa cần quản lý schedule dưới DB. Chốt theo hướng 1: entrypoint thứ hai trong cùng codebase, dùng chung bản build."

## Bối cảnh

Hiện tại backend chỉ có một job định kỳ (đối soát nạp tiền Sepay, FR-011 của
`specs/002-sepay-wallet-topup/spec.md`) và job này chạy ngay bên trong tiến trình phục vụ
API. Sắp tới luồng upload trực tiếp lên object storage (presigned) cần thêm job dọn dẹp,
và các job khác sẽ tiếp tục xuất hiện. Gộp job vào tiến trình API có ba vấn đề: job nặng
làm chậm request của user, khó quan sát job nào đang chạy, và muốn thêm job phải đụng vào
cấu hình của API.

Chủ repo đã chốt (2026-10-27, theo Nguyên tắc V của constitution): tách job định kỳ thành
một dịch vụ riêng, chạy tiến trình riêng và cổng riêng, nhưng vẫn nằm trong cùng mã nguồn
và cùng bản build với API để dùng chung toàn bộ logic nghiệp vụ, truy cập dữ liệu, cache
và object storage. Lịch chạy của từng job đặt qua biến môi trường; chưa quản lý lịch
trong cơ sở dữ liệu.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Job định kỳ chạy trên dịch vụ riêng, API không chạy job nữa (Priority: P1)

Người vận hành muốn job định kỳ chạy trong một dịch vụ riêng, tách khỏi dịch vụ phục vụ
API. Dịch vụ job có cổng riêng để kiểm tra sức khỏe, dùng chung cơ sở dữ liệu, cache và
object storage với API, và chạy cùng phiên bản mã nguồn với API. Job đối soát Sepay hiện có
chuyển sang dịch vụ này và hoạt động y như trước. Dịch vụ API không còn chạy bất kỳ job
nào.

**Why this priority**: đây là giá trị lõi của tính năng. Chưa tách được tiến trình thì
mọi phần khác (thêm job dễ, giám sát, triển khai) không có nền để đứng. Đồng thời phải
đảm bảo job đối soát Sepay không bị gián đoạn vì nó ảnh hưởng tới tiền của user.

**Independent Test**: khởi động hai dịch vụ từ cùng một bản build với cùng một bộ cấu
hình. Xác nhận API vẫn phục vụ request bình thường và nhật ký của API không có dấu vết
job nào chạy. Xác nhận dịch vụ job chạy đối soát Sepay đúng chu kỳ cấu hình và cộng tiền
đúng như trước khi tách. Tắt dịch vụ job, API vẫn phục vụ request; tắt API, dịch vụ job
vẫn chạy đúng chu kỳ.

**Acceptance Scenarios**:

1. **Given** cả hai dịch vụ đã khởi động từ cùng bản build, **When** đến chu kỳ đối soát
   Sepay, **Then** chỉ dịch vụ job thực hiện đối soát, nhật ký API không ghi nhận lần
   chạy nào, và kết quả cộng tiền giống hệt hành vi trước khi tách.
2. **Given** dịch vụ job đang chạy, **When** người vận hành gọi điểm kiểm tra sức khỏe
   trên cổng riêng của dịch vụ job, **Then** nhận được trạng thái "ok" mà không cần đăng
   nhập.
3. **Given** dịch vụ job đang chạy, **When** người vận hành gọi bất kỳ đường dẫn nghiệp vụ
   nào của API (đăng nhập, hồ sơ, nạp tiền...) trên cổng của dịch vụ job, **Then** không
   có đường dẫn nghiệp vụ nào được phục vụ ở đó.
4. **Given** dịch vụ job bị dừng, **When** user gửi request tới API, **Then** API trả lời
   bình thường, không lỗi, không chậm hơn.
5. **Given** dịch vụ API bị dừng, **When** đến chu kỳ của một job, **Then** job vẫn chạy
   đúng giờ trên dịch vụ job.

---

### User Story 2 - Thêm một job mới chỉ bằng một định nghĩa job và một biến cấu hình (Priority: P2)

Lập trình viên (ví dụ người làm luồng upload presigned) muốn thêm một job dọn dẹp định kỳ.
Họ chỉ cần viết định nghĩa job (tên, lịch mặc định, việc cần làm) và đăng ký nó vào một
danh sách duy nhất của dịch vụ job. Lịch chạy lấy từ một biến môi trường mang tên job,
có giá trị mặc định nếu không đặt. Không phải sửa gì ở dịch vụ API.

**Why this priority**: lý do trực tiếp của việc tách là để thêm job dễ và sạch. Nếu thêm
job vẫn phải đụng vào API hoặc phải chỉnh nhiều nơi thì việc tách chưa đạt mục tiêu.

**Independent Test**: thêm một job thử nghiệm chỉ ghi một dòng nhật ký mỗi phút. Xác nhận
chỉ cần tạo định nghĩa job, đăng ký vào danh sách job, và (tùy chọn) đặt biến môi trường
lịch chạy. Khởi động lại dịch vụ job, thấy job mới được liệt kê lúc khởi động và chạy đúng
chu kỳ. Dịch vụ API không thay đổi gì.

**Acceptance Scenarios**:

1. **Given** một job mới được đăng ký với lịch mặc định, **When** dịch vụ job khởi động,
   **Then** nhật ký khởi động liệt kê job đó cùng lịch chạy và thời điểm chạy kế tiếp.
2. **Given** biến môi trường lịch chạy của job được đặt sang giá trị hợp lệ khác mặc định,
   **When** dịch vụ job khởi động, **Then** job chạy theo lịch trong biến môi trường, không
   theo mặc định.
3. **Given** biến môi trường lịch chạy của job bị đặt sai cú pháp, **When** dịch vụ job
   khởi động, **Then** dịch vụ từ chối khởi động và thông báo lỗi nêu rõ tên biến và giá
   trị sai, không chạy ngầm với lịch mặc định.
4. **Given** biến môi trường lịch chạy của job được đặt thành giá trị "tắt", **When** dịch
   vụ job khởi động, **Then** job đó không được lên lịch, nhật ký khởi động ghi rõ job bị
   tắt, các job khác vẫn chạy bình thường.
5. **Given** một job ném lỗi giữa chừng, **When** lần chạy đó kết thúc, **Then** lỗi được
   ghi nhật ký kèm tên job, dịch vụ job vẫn sống, các job khác không bị ảnh hưởng, và lần
   chạy kế tiếp của job đó vẫn diễn ra đúng lịch.
6. **Given** một lần chạy của job kéo dài quá chu kỳ của nó, **When** đến thời điểm chạy kế
   tiếp, **Then** lần chạy mới bị bỏ qua (không chạy chồng), và việc bỏ qua được ghi nhật
   ký.

---

### User Story 3 - Triển khai, giám sát và dừng an toàn (Priority: P3)

Người vận hành muốn dịch vụ job được triển khai tự động cùng API trong mỗi lần deploy, luôn
cùng phiên bản với API, có kiểm tra sức khỏe để deploy biết nó đã lên hay chưa, và khi bị
dừng (deploy phiên bản mới, khởi động lại) thì lần chạy đang dở được phép hoàn tất trong
một khoảng ân hạn thay vì bị cắt ngang. Lập trình viên muốn chạy cả hai dịch vụ ở máy cá
nhân từ cùng một tệp cấu hình với hai cổng mặc định khác nhau.

**Why this priority**: cần thiết để vận hành ổn định nhưng chỉ có ý nghĩa sau khi Story 1
và 2 đã chạy được.

**Independent Test**: thực hiện một lần deploy. Xác nhận cả API và dịch vụ job cùng được
thay bằng phiên bản mới, deploy chờ cả hai báo khỏe, và nếu dịch vụ job không lên được thì
deploy báo thất bại. Dừng dịch vụ job trong lúc một job đang chạy, xác nhận lần chạy đó
được hoàn tất (trong khoảng ân hạn) trước khi tiến trình thoát. Ở máy cá nhân, chạy hai
lệnh khởi động từ cùng tệp cấu hình mà không bị trùng cổng.

**Acceptance Scenarios**:

1. **Given** một lần deploy thành công, **When** người vận hành xem các dịch vụ đang chạy,
   **Then** API và dịch vụ job đều chạy cùng một phiên bản (cùng mã định danh bản build).
2. **Given** dịch vụ job không khởi động được sau deploy, **When** hết thời gian chờ sức
   khỏe, **Then** deploy báo thất bại và in nhật ký của dịch vụ job để chẩn đoán.
3. **Given** một job đang chạy dở, **When** dịch vụ job nhận tín hiệu dừng, **Then** không
   có lần chạy mới nào được bắt đầu, lần chạy dở được phép hoàn tất trong khoảng ân hạn,
   rồi tiến trình thoát; nếu quá ân hạn thì tiến trình vẫn thoát và ghi nhật ký cảnh báo.
4. **Given** lập trình viên có một tệp cấu hình cục bộ, **When** khởi động API và dịch vụ
   job cùng lúc với cấu hình mặc định, **Then** cả hai lên được trên hai cổng khác nhau mà
   không cần sửa thêm biến nào.
5. **Given** dịch vụ job đang chạy trên môi trường triển khai, **When** một người bên ngoài
   gọi tới cổng của dịch vụ job qua Internet, **Then** không truy cập được (cổng chỉ mở
   trong mạng nội bộ của hệ thống triển khai).

---

### Edge Cases

- Cơ sở dữ liệu, cache hoặc object storage chưa sẵn sàng lúc dịch vụ job khởi động: dịch
  vụ job xử lý giống API (khởi động thất bại và được hệ thống triển khai khởi động lại),
  không chạy job với kết nối hỏng.
- Hai bản của dịch vụ job vô tình chạy song song (ví dụ trong vài giây lúc thay phiên bản):
  một job có thể chạy hai lần. Vì chưa có khóa phân tán, mọi job PHẢI an toàn khi chạy lặp
  (job đối soát Sepay đã bảo đảm không cộng trùng theo FR-005 của spec 002).
- Dịch vụ job bị dừng trong một khoảng dài rồi khởi động lại: các lần chạy bị lỡ không
  được chạy bù dồn; job chạy lại từ chu kỳ kế tiếp. Job đối soát Sepay bù đắp bằng cửa sổ
  nhìn lại hiện có.
- Một job tự thay đổi biến môi trường? Không hỗ trợ: lịch chỉ được đọc một lần lúc khởi
  động; muốn đổi lịch phải khởi động lại dịch vụ job.
- Tên hai job trùng nhau: dịch vụ job từ chối khởi động và nêu tên trùng.
- API và dịch vụ job được cấu hình cùng một cổng trên cùng máy: dịch vụ khởi động sau báo
  lỗi trùng cổng rõ ràng thay vì im lặng.
- Dịch vụ job chạy nhưng API đang ở phiên bản cũ hơn (deploy dở): cả hai được thay trong
  cùng một bước deploy nên trạng thái này chỉ tồn tại trong khoảng thay phiên bản; không
  có job nào phụ thuộc vào việc gọi API.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Job định kỳ PHẢI chạy trong một dịch vụ riêng, là một tiến trình độc lập với
  dịch vụ API, lắng nghe trên một cổng riêng khác cổng của API.
- **FR-002**: Dịch vụ API KHÔNG được chạy bất kỳ job định kỳ nào. Dừng dịch vụ job không
  được làm API lỗi hay chậm; dừng API không được làm job bỏ lỡ chu kỳ.
- **FR-003**: Dịch vụ job PHẢI được dựng từ cùng mã nguồn và cùng bản build với API, dùng
  chung các thành phần nghiệp vụ, truy cập dữ liệu, cache, object storage và gửi email. Không
  được sao chép logic nghiệp vụ sang nơi khác.
- **FR-004**: Dịch vụ job PHẢI dùng chung bộ biến cấu hình kết nối (cơ sở dữ liệu, cache,
  object storage, dịch vụ thanh toán) với API; không có bộ thông tin kết nối thứ hai. Dịch
  vụ job chỉ thêm các biến riêng của nó: cổng lắng nghe và lịch chạy từng job.
- **FR-005**: Dịch vụ job PHẢI cung cấp một điểm kiểm tra sức khỏe công khai (không cần
  đăng nhập) trên cổng riêng của nó, và KHÔNG được phục vụ bất kỳ đường dẫn nghiệp vụ nào
  của API.
- **FR-006**: Mỗi job PHẢI có một lịch chạy mặc định được khai báo ngay trong định nghĩa
  job, và một biến môi trường riêng mang tên job cho phép ghi đè lịch bằng biểu thức cron
  tiêu chuẩn. Lịch chạy KHÔNG được lưu trong cơ sở dữ liệu.
- **FR-007**: Nếu biến môi trường lịch chạy của bất kỳ job nào không phải là biểu thức cron
  hợp lệ, dịch vụ job PHẢI từ chối khởi động và thông báo lỗi nêu rõ tên biến và giá trị
  nhận được. Không được lặng lẽ dùng lịch mặc định thay thế.
- **FR-008**: Người vận hành PHẢI tắt được một job bằng cách đặt biến môi trường lịch chạy
  của nó thành một giá trị "tắt" quy ước. Job bị tắt không được lên lịch và PHẢI được ghi
  nhận là tắt trong nhật ký khởi động.
- **FR-009**: Lúc khởi động, dịch vụ job PHẢI ghi nhật ký danh sách mọi job được đăng ký
  gồm tên, lịch chạy đang áp dụng (mặc định hay ghi đè) và thời điểm chạy kế tiếp.
- **FR-010**: Mỗi lần chạy job PHẢI được ghi nhật ký lúc bắt đầu và lúc kết thúc, kèm tên
  job, thời lượng và kết quả (thành công, lỗi, bỏ qua). Lỗi của một lần chạy PHẢI được ghi
  kèm chi tiết lỗi và KHÔNG được làm dừng dịch vụ job hay ảnh hưởng tới job khác.
- **FR-011**: Một job KHÔNG được bắt đầu lần chạy mới khi lần chạy trước của chính nó chưa
  kết thúc; lần chạy bị bỏ qua PHẢI được ghi nhật ký.
- **FR-012**: Thêm một job mới PHẢI chỉ cần: viết định nghĩa job (tên, lịch mặc định, việc
  cần làm) và đăng ký vào một danh sách job duy nhất của dịch vụ job, cộng thêm việc thêm
  biến lịch chạy vào các tệp cấu hình mẫu. Không được yêu cầu sửa dịch vụ API.
- **FR-013**: Job đối soát nạp tiền Sepay hiện có PHẢI được chuyển sang dịch vụ job với
  hành vi không đổi: cùng chu kỳ mặc định, cùng cửa sổ nhìn lại, cùng cách xử lý giao dịch.
- **FR-014**: Mọi job PHẢI an toàn khi bị chạy lặp (chạy hai lần cho cùng một chu kỳ không
  gây sai lệch dữ liệu), vì tính năng này chưa có khóa chống chạy trùng giữa nhiều bản
  dịch vụ job.
- **FR-015**: Hệ thống triển khai PHẢI khởi chạy dịch vụ job cùng với API trong mỗi lần
  deploy, từ cùng một bản build, và PHẢI chờ dịch vụ job báo khỏe trong cùng giới hạn thời
  gian đang áp dụng cho API; dịch vụ job không khỏe thì deploy PHẢI báo thất bại kèm nhật
  ký của nó.
- **FR-016**: Cổng của dịch vụ job PHẢI chỉ truy cập được trong mạng nội bộ của hệ thống
  triển khai, không được công bố ra Internet qua reverse proxy.
- **FR-017**: Khi nhận tín hiệu dừng, dịch vụ job PHẢI ngừng bắt đầu lần chạy mới, cho lần
  chạy đang dở hoàn tất trong một khoảng ân hạn có cấu hình (mặc định 30 giây), rồi thoát;
  quá ân hạn thì thoát và ghi cảnh báo.
- **FR-018**: Ở môi trường phát triển cục bộ, API và dịch vụ job PHẢI khởi động được từ
  cùng một tệp cấu hình với hai cổng mặc định khác nhau, mỗi dịch vụ có lệnh khởi động
  riêng được ghi trong hướng dẫn phát triển.
- **FR-019**: Tệp cấu hình mẫu cho môi trường phát triển và môi trường triển khai PHẢI
  liệt kê các biến mới của dịch vụ job (cổng, lịch chạy từng job, khoảng ân hạn khi dừng)
  kèm giải thích ngắn.

### Key Entities *(include if feature involves data)*

- **Job định kỳ (Scheduled Job)**: một đơn vị công việc chạy theo lịch, gồm tên duy nhất,
  lịch chạy mặc định, biến môi trường ghi đè lịch, trạng thái bật/tắt, và việc cần làm.
  Danh sách job là nguồn sự thật duy nhất về "hệ thống có những job nào".
- **Lần chạy (Job Run)**: một lần thực thi của một job, gồm thời điểm bắt đầu, thời điểm
  kết thúc, thời lượng, kết quả (thành công, lỗi, bỏ qua vì đang chạy dở). Chỉ ghi nhật ký,
  không lưu vào cơ sở dữ liệu trong phạm vi tính năng này.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Sau khi tách, trong 24 giờ vận hành liên tục, nhật ký của dịch vụ API ghi
  nhận 0 lần chạy job, và nhật ký của dịch vụ job ghi nhận đủ 100% số chu kỳ đối soát
  Sepay theo lịch cấu hình (không tính các khoảng thay phiên bản khi deploy).
- **SC-002**: Kết quả đối soát nạp tiền sau khi tách giống hệt trước khi tách: 0 giao dịch
  cộng trùng, 0 giao dịch hợp lệ bị bỏ sót, trên cùng tập giao dịch thử nghiệm.
- **SC-003**: Một lập trình viên chưa từng đụng vào dịch vụ job thêm được một job mới chạy
  đúng lịch trong dưới 30 phút, không sửa bất kỳ tệp nào thuộc dịch vụ API.
- **SC-004**: 100% trường hợp đặt sai biểu thức lịch chạy bị phát hiện lúc khởi động, dịch
  vụ job từ chối chạy trong vòng 10 giây và thông báo nêu đúng tên biến sai.
- **SC-005**: Dừng hoặc khởi động lại dịch vụ job không gây ra bất kỳ request API nào thất
  bại (0 lỗi trong khoảng thao tác), và dừng API không làm lỡ bất kỳ chu kỳ job nào.
- **SC-006**: Mỗi lần deploy, cả hai dịch vụ cùng phiên bản trong 100% lần deploy thành
  công; deploy báo thất bại trong 100% trường hợp dịch vụ job không khỏe trong giới hạn
  thời gian chờ đang áp dụng.
- **SC-007**: Khi khởi động lại dịch vụ job trong lúc một job đang chạy, lần chạy đó hoàn
  tất bình thường nếu nó kết thúc trong khoảng ân hạn; 0 lần chạy bị cắt ngang trong các
  lần khởi động lại thông thường của bộ thử nghiệm.

## Assumptions

- **Hướng đã chốt**: chủ repo xác nhận ngày 2026-10-27 chọn hướng "điểm khởi động thứ
  hai trong cùng mã nguồn, cùng bản build" thay cho các hướng khác đã cân nhắc (tách
  monorepo nhiều ứng dụng, gate bằng biến vai trò trong một tiến trình, hàng đợi worker,
  bộ lập lịch bên ngoài). Lý do: đáp ứng đủ năm yêu cầu (cổng riêng, dùng chung module,
  chỗ cho job upload presigned, dịch vụ job gọn, lịch qua biến môi trường) với ít thay đổi
  nhất; nâng cấp lên hàng đợi worker sau này không đổi cách tổ chức.
- Chỉ chạy **một bản** dịch vụ job tại một thời điểm. Khóa chống chạy trùng giữa nhiều bản
  nằm ngoài phạm vi; thay vào đó FR-014 yêu cầu job an toàn khi chạy lặp.
- Lịch chạy chỉ qua biến môi trường. Quản lý lịch trong cơ sở dữ liệu, giao diện bật/tắt
  job lúc đang chạy, và kích hoạt job thủ công theo yêu cầu đều nằm ngoài phạm vi.
- Lịch sử lần chạy chỉ ghi nhật ký; không lưu bảng lịch sử trong cơ sở dữ liệu.
- **Job dọn dẹp cho luồng upload presigned** của Nga nằm ngoài phạm vi spec này và sẽ có
  spec riêng khi luồng đó được đưa vào repo. Spec này bảo đảm dịch vụ job và cách thêm job
  (FR-012) đã sẵn sàng để job đó được thêm vào mà không phải sửa API.
- Biến `SEPAY_RECONCILE_INTERVAL_MINUTES` tiếp tục là cửa sổ nhìn lại khi gọi Sepay; lịch
  chạy của job đối soát có biến riêng theo FR-006 với mặc định tương đương chu kỳ hiện tại.
- Dịch vụ job là thành phần nội bộ: hệ thống triển khai không cấp tên miền hay chứng chỉ
  cho nó; chỉ dịch vụ API được công bố ra ngoài như hiện nay.
- Khoảng ân hạn khi dừng mặc định 30 giây, có thể chỉnh qua biến môi trường. Hệ thống
  triển khai cần cho tiến trình ít nhất bằng khoảng này trước khi buộc dừng.
- Dịch vụ job phụ thuộc vào cùng các dịch vụ hạ tầng với API (cơ sở dữ liệu theo
  `specs/004-cloud-sql-postgres`, cache cục bộ, object storage) và đi qua cùng đường mạng
  mà API đang dùng để tới chúng.
