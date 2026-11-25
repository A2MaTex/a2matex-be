# Specification Quality Checklist: Sổ ghi biến động số dư ví và tài khoản tiền của sàn

**Purpose**: Validate specification completeness and quality before proceeding to planning

**Created**: 2026-11-24 · **Re-validated**: 2026-11-25 (sau khi thiết kế lại phần tiền của sàn)

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

## Kiểm lại vòng 2026-11-25

Lần rà này chạy sau khi spec đổi lớn: bỏ "số dư mở đầu", thêm tài khoản tiền của sàn, tách việc
quản trị viên cộng tiền thành chuyển khoản hai chân, thêm việc bơm tiền vào tài khoản của sàn.

| Hạng mục | Kết quả | Ghi chú |
|---|---|---|
| Rò rỉ định danh kỹ thuật | **đạt** | quét tên bảng, tên cột, tên loại bút toán, ràng buộc SQL trong `spec.md` → 1 chỗ lọt (`userId` ở mục Clarifications), đã sửa thành tên nghiệp vụ |
| `[NEEDS CLARIFICATION]` còn sót | **đạt** | 0 chỗ |
| FR kiểm thử được | **đạt** | 46 FR, mỗi FR nêu một hành vi quan sát được; FR-021 và FR-035 nói rõ hành vi khi thất bại chứ không chỉ khi thành công |
| SC đo được | **đạt** | 12 SC; SC-010, SC-011, SC-012 là ba tiêu chí mới cho phần tiền của sàn |
| Edge case | **đạt** | 10 trường hợp, trong đó 3 trường hợp mới: ví sàn không đủ tiền, dọn chưa sạch, chuyển khoản thiếu chân |
| Phạm vi rõ ràng | **đạt** | mục Out of Scope nêu đích danh 10 thứ, kèm lý do với hai thứ dễ nhầm nhất (giữ tiền bảo hành, tách loại tiền nạp thật) |

## Rủi ro đã ghi nhận, không chặn việc lập plan

- **Cam kết vận hành thay cho ràng buộc kỹ thuật.** Việc "không dùng chức năng bơm tiền cho tiền
  công ty nạp thật" nằm ở mục Assumptions, không có gì trong hệ thống ép nó. Đây là lựa chọn có ý
  thức (quy mô hiện tại), nhưng là chỗ đầu tiên sẽ hỏng nếu nghiệp vụ đổi.
- **Việc dọn dữ liệu không hoàn tác được.** Chủ repo đã xác nhận ngày 2026-11-25 dù hai tài khoản
  test vẫn đang dùng. Bước dọn phải chạy riêng, review riêng, và ghi vào runbook.

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`
- Toàn bộ hạng mục đạt ở lần rà đầu tiên của vòng 2026-11-25; không phải lặp lại lần hai.
