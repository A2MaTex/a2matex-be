# Specification Quality Checklist: Quản trị viên duyệt đơn rút tiền và xem sổ cái

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-27
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

**Quy mô**: 39 FR, 10 SC, 4 user story, 12 edge case. Không còn `[NEEDS CLARIFICATION]` — 8 quyết
định thiết kế đã chốt trực tiếp với chủ repo trước khi viết, và 2 câu còn lại (duyệt một bước hay
hai bước; phạm vi có gồm phần xem sổ cái không) được hỏi và chốt ngay đầu phiên.

**Quá trình kiểm**: spec viết một lần rồi đối chiếu với từng mục ở trên, kèm hai phép quét tự động —
tìm chi tiết hiện thực lọt vào (mã HTTP, tên bảng, giá trị trạng thái, câu SQL) và tìm FR không có
kịch bản nghiệm thu. Cả hai đều sạch. Các từ "route" và "API" còn lại nằm ở Bối cảnh, Assumptions
và Out of Scope — cùng cách dùng với spec 012, không phải trong phần yêu cầu.

**Lượt soi thứ hai** (chủ repo yêu cầu verify trước khi sang plan) — tìm 7 chỗ người hiện thực sẽ
phải đoán, đã sửa hết. Spec đi từ 39 FR → **42 FR**:

| # | Mơ hồ | Chốt thành |
|---|---|---|
| 1 | `SC-008` **không kiểm chứng được**: nói "ba con số nguồn cộng lại trừ đi khoản đã tiêu", nhưng FR-030 chỉ liệt kê 3 nguồn VÀO, không có chiều RA | FR-030 liệt kê cả hai chiều; thêm **FR-030a** đòi bảng tự cân; viết lại SC-008 |
| 2 | Danh sách đơn: không nói mặc định trả gì, có gồm đơn đã huỷ không | FR-005 — không lọc thì trả **mọi trạng thái** |
| 3 | "đang chờ chi" xuất hiện 5 lần, **không định nghĩa** gồm trạng thái nào | **FR-033a** định nghĩa cả hai túi theo trạng thái đơn |
| 4 | FR-027 (sổ cái) thiếu yêu cầu thứ tự ổn định, trong khi FR-007 (danh sách đơn) có — bất đối xứng dù cả hai đều phân trang | FR-027 bổ sung cùng yêu cầu |
| 5 | "danh tính nhà phát hành" — mã định danh hay tên người? | FR-006 đòi **dạng người đọc được**, tối thiểu tên + email |
| 6 | Không nói trần phân trang | **FR-007a** đòi có trần, vượt trần thì từ chối |
| 7 | "đơn chưa được hoàn" ở SC-003 không định nghĩa | Nêu rõ: mọi đơn trừ đã huỷ và bị từ chối |

Chỗ #1 là nặng nhất: một bảng dùng để quyết định chi tiền mà không tự cân được thì không kiểm
chứng được, và quản trị viên không có cách nào biết nó đúng hay sai.

**Rút kinh nghiệm từ spec 012** — ba lỗi của lần trước đã chủ động tránh ngay từ bản đầu:

1. *Mã HTTP trong Edge Cases* (lỗi lượt 1 của spec 012) → lần này không có mã nào, chỉ dùng "câu
   trả lời nghiệp vụ" / "lỗi hệ thống".
2. *Thiếu ràng buộc về thứ tự các phép kiểm* (lỗi chặn của spec 012) → FR-014 nêu rõ phải duyệt
   trước mới chi được, và FR-038 nêu yêu cầu chống song song thành một mục riêng.
3. *Thuật ngữ không định nghĩa* ("cùng nội dung", "đơn còn hiệu lực") → lần này mọi tập trạng thái
   đều liệt kê ra: FR-018 nói rõ từ chối được ở hai trạng thái nào, FR-019/FR-020 nói rõ trạng
   thái nào không.

**Một hệ quả được ghi rõ thay vì giấu đi**: FR về việc ghi "ai xử lý" chỉ giữ **người gần nhất**.
Đơn được duyệt rồi bị từ chối sẽ mất dấu người duyệt. Đã đưa vào Assumptions kèm lý do chấp nhận
(thao tác động tới tiền vẫn có dấu vết trong sổ cái; việc duyệt không động tới tiền) và kèm cách
làm đúng nếu sau này cần (bảng nhật ký riêng, ngoài phạm vi).

**Điểm cần chú ý khi sang `/speckit-plan`** (thuộc tầng hiện thực, cố ý không đưa vào spec):

- Mọi lần đổi trạng thái phải là **một câu `UPDATE` có điều kiện** `WHERE id = ? AND status = ?`,
  không tách `SELECT ... FOR UPDATE` rồi `UPDATE`. Đây là R8 của spec 012, đã chứng minh bằng ca
  kiểm 5 lệnh huỷ song song ra 1×200 + 4×409 và không một lỗi 500 nào.
- Khoá `Profile` luôn trước mọi khoá khác, giữ thứ tự khoá toàn cục của order/wallet/withdrawal.
- `processedAt` và mọi mốc thời gian lấy `now()` của database. Spec 012 từng viết nhầm
  `new Date()` ở `cancelIfPending` và bị code review bắt.
- `WalletTransaction_actor_check` hiện **không** ép `createdById` + `note` cho loại hoàn tiền (cố
  ý, vì nhà phát hành tự huỷ không có quản trị viên). FR-023 đòi đường từ chối phải có cả hai →
  tầng ứng dụng phải tự đảm bảo, hoặc sửa ràng buộc thành có điều kiện theo trạng thái đơn.
- Bảng đối soát phải dùng **đẳng thức hai túi**; bản một-số-hạng là sai và runbook đã được sửa ở
  spec 012.
- Route quản trị dùng **gác quyền thật**, nên lần triển khai này **bắt buộc** chạy seed phân quyền —
  ngược với spec 012. Đã kiểm 2026-11-27: an toàn.
- Unit test viết đầy đủ nhưng **không commit** (`.gitignore`), vì test import service sẽ chạm
  `config.ts` và giết CI. Tuy nhiên spec 012 đã đo được: test **chỉ import schema thuần** thì chạy
  tốt không cần `.env` — nhóm đó commit được.
