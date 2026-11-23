# Specification Quality Checklist: Studio Release

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

## Verification pass — 2026-11-23

Soát lại spec bằng cách đối chiếu từng FR với mã nguồn thật (`launcher-release`, `static`,
`create-permissions`). Tám thiếu sót được tìm ra và đã vá vào spec:

| # | Thiếu sót | Xử lý |
| --- | --- | --- |
| 1 | Studio không có đường tải tệp công khai: mọi route lấy bytes đều đòi token, chỉ `statics/images/:id` public | Chủ repo chốt giữ như Launcher (phải đăng nhập) → FR-020, SC-007, Out of Scope |
| 2 | Không có cách gỡ bản hiệu lực khi bản *đầu tiên* lỗi | Quyết định mới → FR-021, US2 kịch bản 8–9 |
| 3 | "semver nghiêm ngặt" chưa nói rõ có cho `-beta.1` không (pattern thực tế **không** cho) | FR-003 ghi rõ |
| 4 | `pageSize` không có trần (Launcher cho số nguyên dương bất kỳ) | FR-022 |
| 5 | Không kiểm tra kiểu tệp — có thể trỏ bản phát hành vào một tấm ảnh | Assumptions + Edge Cases |
| 6 | Xoá tệp của bản đang hiệu lực không bị chặn, và tệp mất khỏi kho lưu trữ vĩnh viễn | Edge Cases + Out of Scope |
| 7 | Bản có tệp đã xoá có còn hiện cho Admin không | FR-023 |
| 8 | Đua khi hai Admin tạo trùng số phiên bản | Edge Cases |

Phạm vi đã soát: toàn bộ 6 endpoint và các ràng buộc của `launcher-release` đều có FR tương ứng,
và toàn bộ route `@IsPublic()` trong repo đã được liệt kê để kiểm tra đường tải. **Chưa** soát
phía ứng dụng Studio — client không nằm trong repo này, nên phần tích hợp đầu-cuối vẫn cần người
làm Studio xác nhận.

## Quyết định chốt thêm — 2026-11-23 (lượt 2)

Sau lượt soát, chủ repo chốt 5 điểm còn mở; spec đã cập nhật theo:

1. **Tải tệp phải đăng nhập**, giữ như Launcher — không mở đường tải công khai (FR-020, Out of
   Scope).
2. **Bản đang hiệu lực chỉ sửa được ghi chú**; đổi số phiên bản hay tệp phải gỡ hiệu lực trước
   (FR-016). Khác Launcher.
3. **Không backport** các cải tiến sang `launcher-release` trong phạm vi này (Out of Scope).
4. **Log mọi thao tác ghi**, không chỉ kích hoạt (FR-019).
5. **Test**: unit cho service + một e2e luồng chính (ghi trong `planning-notes.md`).

Còn lại hai câu thuần kỹ thuật cho `/speckit-plan`, không cần hỏi chủ repo: cách bắt trùng số
phiên bản, và hình dạng route cho thao tác gỡ hiệu lực.

## Sau `/speckit-plan` — 2026-11-23

Spec và plan đã được rà cho khớp nhau:

- `spec.md` trỏ tới `plan.md` và nêu rõ thứ tự ưu tiên khi lệch: chi tiết kỹ thuật theo plan, hành
  vi nghiệp vụ theo spec.
- `plan.md` có bảng **Truy vết yêu cầu**: 23/23 FR đều có chỗ thiết kế và chỗ kiểm chứng; 14/14
  kịch bản quickstart đều được bảng nhắc tới; không có FR hay kịch bản mồ côi.
- Mã lỗi dùng trong `quickstart.md` và `planning-notes.md` đều nằm trong bảng của
  `contracts/studio-release-api.md`.
- `planning-notes.md` có banner ghi rõ phần nào đã bị `research.md` thay thế, trong đó có nhận
  định sai về `cacheProvider`.
- Hai chỗ spec tự sửa theo phát hiện lúc lập plan: giả định về seed permission (seed **không** bỏ
  qua route công khai), và bỏ "dọn dependency không dùng" khỏi Out of Scope.

## Notes

- Chi tiết kỹ thuật (bảng, cột, route, mã lỗi, file sẽ tạo) được tách sang
  [planning-notes.md](../planning-notes.md) để `spec.md` giữ mức nghiệp vụ — cùng cách làm với
  `006-entitlement`.
- Hai tham chiếu tới mã nguồn còn lại trong `spec.md` là **cố ý**, không phải rò rỉ chi tiết triển
  khai: phần đầu file trỏ tới `src/routes/launcher-release/` để người đọc biết đây là tính năng
  song song với Launcher đã chạy, và Clarifications nêu các điểm khác biệt so với Launcher.
- Bốn quyết định của chủ repo (không tách hệ điều hành, không checksum, semver nghiêm ngặt +
  duy nhất, cho phép rollback) đã được ghi trong Clarifications nên không còn
  `[NEEDS CLARIFICATION]` nào.
- Ba câu hỏi kỹ thuật còn mở được ghi ở cuối `planning-notes.md` cho `/speckit-plan`, không phải
  câu hỏi nghiệp vụ nên không chặn spec.
