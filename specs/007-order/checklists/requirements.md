# Specification Quality Checklist: Order — customer mua quyền dùng Product bằng số dư

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-21
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

- Bản nháp 2026-11-21 (commit `a19833e`) FAIL "No implementation details": chứa mã lỗi HTTP, bảng
  route, câu SQL trừ số dư, tên cột và thứ tự khoá row. Đã viết lại spec bằng ngôn ngữ nghiệp vụ và
  chuyển toàn bộ chi tiết kỹ thuật sang [`planning-notes.md`](../planning-notes.md), giống cách
  spec 006 đã làm.
- Iteration 2: sửa ba chỗ còn rò rỉ — FR-033 nhắc "giới hạn số nguyên an toàn của JavaScript";
  FR-010 mô tả ràng buộc ở tầng dữ liệu; FR-042 yêu cầu seed permission trong cùng PR (đây là quy
  trình triển khai theo Constitution II, đã nằm trong planning-notes nên gỡ khỏi spec). Sau đó PASS
  toàn bộ.
- Chỉ có **một** câu hỏi cần người dùng chốt và đã chốt trong phiên 2026-11-21: mua khi quyền còn
  hiệu lực → **chặn hoàn toàn**. Các lựa chọn gia hạn/cộng dồn đều kéo theo sửa spec 006 (FR-011 của
  006 quy định kỳ mới luôn bắt đầu từ thời điểm mua, không cộng dồn).
- Những quyết định khác được chốt từ bản nháp cũ và giữ nguyên: thanh toán chỉ bằng số dư, bắt buộc
  mã chống trùng, quyền bị thu hồi chặn mua lại, doanh thu/chia tiền Publisher ngoài phạm vi.
- Spec đã đối chiếu với code đang chạy ngày 2026-11-21 (xem mục "Đã đối chiếu với codebase" trong
  planning-notes). Bốn điểm bản nháp cũ ghi sai hoặc thiếu đã sửa:
  1. Đổi giá gói **không** làm gói biến mất (danh tính gói là loại + thời lượng, giá không thuộc
     danh tính) → bản nháp cũ ngụ ý đổi giá có thể dẫn tới "không tìm thấy gói".
  2. Gói cũ bị xoá mềm nên tham chiếu lịch sử luôn hợp lệ — nay là dữ kiện đã kiểm chứng, không còn
     là giả định.
  3. Ràng buộc "gói thuê bao phải có giá > 0 và thời lượng hữu hạn, chỉ gói một lần mới được miễn
     phí/vĩnh viễn" đã có sẵn trong tính năng Product Offer; spec dựa vào, không định nghĩa lại.
  4. Thêm FR-040: bổ sung ràng buộc toàn vẹn cho tham chiếu từ quyền dùng tới lần mua gần nhất —
     spec 006 cố ý để lại chưa ràng buộc vì đơn hàng chưa tồn tại.
- FR-010 (chặn quyền bị thu hồi trước khi kích hoạt) đến từ một bẫy đã kiểm chứng bằng thực nghiệm
  trên code 006 ngày 2026-11-21: gọi thẳng bước kích hoạt trên quyền đang bị thu hồi làm transaction
  bị huỷ ở tầng ràng buộc dữ liệu.
