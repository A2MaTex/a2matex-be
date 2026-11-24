# Specification Quality Checklist: Chia tiền bán hàng giữa sàn và nhà phát hành

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-23
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

Spec này viết bằng ngôn ngữ nghiệp vụ **ngay từ bản đầu**, rút kinh nghiệm từ spec 009 — ở đó bản
đầu nhét tên cột, tên khóa cấu hình và cơ chế ràng buộc vào thẳng phần Requirements rồi phải viết
lại toàn bộ. Định danh kỹ thuật và cơ chế thuộc về [data-model.md](../data-model.md) và
[research.md](../research.md); spec chỉ phát biểu điều kiện quan sát được.

Hai chỗ đáng chú ý về cách diễn đạt:

1. **FR-002 và SC-002** nói "hệ thống PHẢI không thể lưu được một đơn hàng vi phạm" và "kể cả khi
   ghi dữ liệu trực tiếp không qua ứng dụng". Đây là yêu cầu nghiệp vụ thật — tổng hai phần phải
   khớp tuyệt đối ở mọi đường ghi — chứ không phải mô tả cách làm. Cơ chế cụ thể nằm ở data-model.

2. **FR-008 và SC-005** nói hai giao dịch đồng thời "không bao giờ kẹt lẫn nhau". Phát biểu được
   hậu quả quan sát được mà không nhắc tới thứ tự khoá; cách đạt nằm ở research.

## Đã sửa sau khi đối chiếu mã nguồn và dữ liệu thật (2026-11-23)

Chạy một lượt verify trước `/speckit-plan`, giống bước research của spec 009. Bốn giả định về lược
đồ đều đúng (mỗi sản phẩm đúng một nhà phát hành; tài khoản nhà phát hành 1-1 với người dùng; ví
là duy nhất cho mỗi người; chưa có chỗ nào chặn tự mua). Nhưng dữ liệu thật lộ ra một chuyện spec
chưa lường:

**2 trong 5 đơn trên production là nhà phát hành tự mua sản phẩm của chính mình.** FR-012 chặn
việc này từ nay, nhưng hai đơn cũ vẫn nằm đó. Nếu bước chuyển đổi dữ liệu chia tiền cho chúng thì
sẽ cộng tiền cho người đã mua chính hàng của mình. Ba sửa đổi:

- **FR-016b** mới: đơn cũ dạng tự mua không được chia tiền, bất kể cách xử lý chung là gì.
- **FR-012b** mới: nêu rõ FR-012 chính là thứ bảo đảm mỗi giao dịch luôn đụng **hai ví khác nhau**
  — yêu cầu về giao dịch đồng thời ở FR-008 dựa trên điều đó. Không ghi ra thì người triển khai sẽ
  phải tự đoán có cần xử lý trường hợp hai ví trùng nhau hay không.
- **Edge case** mới cho đơn tự mua đã tồn tại.

Mục Assumptions cũng được thay bằng số liệu thật: sau khi trừ 2 đơn tự mua, phần còn lại là
**200.000 ₫ bán thật**, và một nhà phát hành đã bán 198.000 ₫ mà ví đang là 0 ₫. Con số đó làm
quyết định dưới đây đáng cân nhắc hơn hẳn so với lúc chỉ biết tổng 220.000 ₫.

## Quyết định từng để mở, nay đã chốt

Bản đầu để ngỏ cách xử lý 5 đơn hàng đã có trên production, với mặc định tạm là ghi toàn bộ về phía
sàn. **Chốt ngày 2026-11-23**: chủ repo xác nhận cả 5 đơn là giao dịch thử của chính mình, không
phải khách thật.

Hệ quả làm thiết kế gọn hơn hẳn:

- Bước chuyển đổi dữ liệu còn **một câu lệnh duy nhất**, không chia hai nhóm, không có nhánh điều
  kiện.
- Migration **không chứa câu `UPDATE "Profile"` nào** — không còn là migration đụng tiền, nên không
  cần lo chạy đúng một lần.
- Gỡ được một dòng rủi ro khỏi plan.

FR-016b (đơn tự mua không được chia tiền) **giữ nguyên** dù hiện tại trùng với luật chung, để nếu
sau này có môi trường với đơn thật và luật chung đổi thì nó vẫn chặn đúng chỗ.

Cách đi này đã trả giá đúng chỗ: nếu dừng lại chờ câu trả lời thì spec không viết được, còn nếu âm
thầm chọn mặc định thì quyết định sẽ không ai thấy. Ghi ra kèm số liệu thật (140.000 ₫ chênh lệch)
là thứ làm chủ repo trả lời được dứt khoát.

## Đối chiếu Constitution

- **Nguyên tắc I** (xác thực ở ranh giới): FR-005 bắt bỏ qua tỉ lệ do khách gửi; FR-004 cấm rơi về
  giá trị mặc định khi thiếu cấu hình.
- **Nguyên tắc II** (route nào permission nấy, seed cùng PR): FR-021 và FR-022. FR-022 được nêu
  thành yêu cầu riêng vì thiếu nó từng gây sự cố 403 trên production ngày 2026-11-23.
- **Nguyên tắc III** (migration đi trước): FR-016 buộc mọi đơn cũ phải có đủ thông tin sau khi
  triển khai, tức bước chuyển đổi dữ liệu là bắt buộc chứ không tuỳ chọn.
- **Nguyên tắc V** (quyết định phải có spec): spec này là cổng cho việc tiền bắt đầu chạy vào ví
  nhà phát hành.
- **Nguyên tắc VI** (YAGNI): mục Out of Scope loại tài khoản riêng cho sàn, tỉ lệ theo từng
  publisher, kỳ giữ tiền và bảng tổng hợp sẵn — bốn thứ dễ bị thêm sớm khi chưa có nhu cầu.
