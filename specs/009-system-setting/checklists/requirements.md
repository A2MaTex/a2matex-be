# Specification Quality Checklist: System Setting — kho cấu hình runtime cho admin

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

Spec đã được **viết lại ngày 2026-11-23** sau khi chủ repo yêu cầu đạt bằng được hai mục
"no implementation details" thay vì chấp nhận để trống.

Bản đầu lập luận rằng gỡ chi tiết kỹ thuật đi thì FR-005 và SC-004 mất tính kiểm thử. **Lập luận
đó sai** — nó bỏ qua phương án thứ ba: đưa định danh kỹ thuật và cơ chế xuống đúng tài liệu thiết
kế của chúng, còn spec nói bằng ngôn ngữ nghiệp vụ. Kết quả là spec vừa sạch vừa giữ nguyên tính
kiểm thử:

| Thứ bị gỡ khỏi spec | Chuyển sang | Yêu cầu tương ứng vẫn kiểm được vì |
|---------------------|-------------|-------------------------------------|
| Tên khóa cấu hình | [data-model.md](../data-model.md) mục 3 | FR-013 gọi tên 4 mục bằng tên nghiệp vụ, ánh xạ 1-1 sang định danh kỹ thuật |
| "check constraint ở database" | [data-model.md](../data-model.md) mục 4 | FR-005 phát biểu điều kiện quan sát được: giá trị sai **không thể tồn tại trong dữ liệu**, kể cả khi ghi trực tiếp không qua ứng dụng. SC-004 kiểm đúng điều đó |
| Đường dẫn file, số dòng, mã commit | [research.md](../research.md), [plan.md](../plan.md) | Là bằng chứng cho quyết định, không phải yêu cầu |
| Tên biến môi trường | [research.md](../research.md) R7, [plan.md](../plan.md) | FR-016 nói "giá trị bí mật dùng để xác thực với nhà cung cấp thanh toán" — đủ xác định, không cần tên biến |
| Trình tự hai bước phát hành | [plan.md](../plan.md) R7 | FR-014 phát biểu kết quả cần đạt (không có khoảng trống dữ liệu), không phát biểu cách đạt |

Số hiệu FR và SC **giữ nguyên** qua lần viết lại, nên các tham chiếu trong
[quickstart.md](../quickstart.md) và [tasks.md](../tasks.md) không bị hỏng.

### Đã sửa sau rà soát

- **FR-017** ban đầu chỉ seed tỉ lệ hoa hồng. Mâu thuẫn với FR-006: thứ tự deploy là migration
  trước, thay container sau, nên 3 dòng ngân hàng chưa tồn tại lúc container mới khởi động →
  ứng dụng từ chối khởi động → bước nạp giá trị không bao giờ chạy tới. Đã sửa thành seed cả 4
  dòng, 3 dòng ngân hàng để rỗng.
- **FR-011b** thêm mới: Nguyên tắc II yêu cầu invalidate cache role-permission sau khi seed, bản
  đầu bỏ sót.
- **FR-015** đã nêu đích danh bên tiêu thụ sau khi kiểm chứng bằng mã nguồn:
  `src/routes/topup/topup.service.ts:44-56`. Trước khi kiểm chứng, User Story 1 chỉ là giả định
  rằng có đường đọc; nay đã xác nhận khách thực sự nhận 3 trường này khi tạo yêu cầu nạp tiền, nên
  mức ưu tiên P1 là đúng.

## Đối chiếu Constitution

- **Nguyên tắc I** (ranh giới xác thực bằng Zod, app từ chối khởi động nếu thiếu config): FR-006
  giữ nguyên tinh thần này sau khi 3 trường SePay rời biến môi trường — kho cấu hình phải tự kiểm
  tra lúc khởi động thay cho `configSchema`. Đây là điểm dễ mất nhất khi chuyển config xuống
  database và đã được nêu thành yêu cầu bắt buộc.
- **Nguyên tắc II** (route nào permission nấy, seed cùng PR): FR-011.
- **Nguyên tắc III** (migration đi trước): FR-014 và FR-017; migration seed sẵn tỉ lệ hoa hồng và
  quy trình hai bước deploy đảm bảo không có khoảng trống dữ liệu.
- **Nguyên tắc V** (quyết định hạ tầng phải có spec): spec này chính là cổng đó cho việc chuyển
  cấu hình SePay ra khỏi biến môi trường.
- **Nguyên tắc VI** (YAGNI): mục Out of Scope loại bỏ lịch hiệu lực tương lai, phân quyền theo
  khóa và cache — ba thứ dễ bị thêm sớm mà chưa có nhu cầu thật.
