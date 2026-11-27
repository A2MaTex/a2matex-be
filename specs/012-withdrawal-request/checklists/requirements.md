# Specification Quality Checklist: Tạo đơn rút tiền cho nhà phát hành

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

Không còn `[NEEDS CLARIFICATION]` nào: 14 quyết định thiết kế đã được chủ repo chốt trực tiếp
trước khi viết spec (ai được rút, trừ tiền lúc nào, nguồn tài khoản ngân hàng, phí, mức tối
thiểu, mốc T+1, cách tính đơn huỷ, số đơn chờ, tự huỷ, cách chi tiền, loại bút toán, tập trạng
thái, chống lặp, KYC/thông báo).

**Quá trình kiểm**: spec viết một lần, đối chiếu với từng mục ở trên, rồi soi lại lần hai theo
yêu cầu của chủ repo ("spec còn mơ hồ hay xử lý không hợp lý ở đoạn nào không").

*Lượt 1* — sửa 1 chỗ: Edge Cases có mã lỗi HTTP (`422`, `500`), là chi tiết hiện thực lọt vào spec.
Đã thay bằng "lỗi dữ liệu đầu vào" / "lỗi hệ thống".

*Lượt 2* — tìm ra **4 lỗi chặn** và 5 chỗ mơ hồ, đã sửa hết (spec đi từ 39 FR → 43 FR, 9 SC → 10 SC):

| # | Vấn đề | Sửa thành |
|---|---|---|
| 1 | US1 #7 nói yêu cầu lặp phải trả về đơn cũ, nhưng FR-013 (24 giờ) sẽ từ chối nó trước. Không FR nào quy định thứ tự → mọi lần thử lại trong 24 giờ đều hỏng | **FR-016a** |
| 2 | Đối soát dòng tiền coi lúc tạo đơn là lúc tiền rời hệ thống → sổ sách báo thiếu tiền công ty đang giữ, đúng bằng tổng đơn chưa chi | **FR-032 / FR-032a / SC-006a** |
| 3 | Hai lệnh huỷ song song cùng đọc "chờ duyệt", cái thứ hai vấp unique index → lỗi hệ thống, mâu thuẫn trực tiếp với SC-009 | **FR-025a** |
| 4 | FR-012 bảo coi "không đọc được" là lỗi cấu hình → lặp lại đúng bug luồng mua hàng đã sửa (nuốt lỗi hạ tầng thành lỗi cấu hình, chỉ người vận hành đi sửa dòng cấu hình bình thường) | **FR-012a** |
| 5 | FR-029/FR-031 mô tả đường admin từ chối — ngoài phạm vi lát cắt này | Tách rõ "thiết kế để nhận" vs "hiện thực bây giờ" |
| 6 | "Cùng nội dung" ở FR-034/035 không định nghĩa | Nêu đủ 4 trường phải khớp |
| 7 | SC-002 dùng "đơn còn hiệu lực" không định nghĩa | Đổi thành "đơn chưa được hoàn" |
| 8 | FR-019 (bản chụp thông tin ngân hàng) không kiểm chứng được trong lát cắt này | Thêm cách kiểm cụ thể + lý do giữ |
| 9 | FR-013 không nói mốc neo là thời điểm nào của đơn | Nêu rõ: **thời điểm tạo** |

Hai chỗ nhỏ: FR-022 gọi đúng tên hai trạng thái thay vì "đầu và cuối"; thêm vào Out of Scope tình
huống nhà phát hành bị xoá mềm khi còn đơn chờ chi.

**Mục FR-039 đã được chốt** (chủ repo quyết 2026-11-27): ba route theo hình dạng của trang doanh
thu nhà phát hành — bỏ qua so khớp quyền theo vai trò, service tự lọc theo danh tính trong phiên
đăng nhập, vẫn seed bản ghi Permission để thoả Nguyên tắc II. Lý do loại bỏ phương án gác quyền
thật: `create-permissions.ts` chỉ cấp quyền cho ADMIN, nên route gác quyền theo vai trò sẽ trả
403 cho **mọi** nhà phát hành cho tới khi có người sửa database bằng tay; và phương án đó còn
phụ thuộc món nợ chưa trả ở nhánh `feat/seed-permissions`.

**Điểm cần chú ý khi sang `/speckit-plan`** (thuộc tầng hiện thực, cố ý không đưa vào spec):

- Thêm giá trị enum rồi dùng ngay trong cùng một file migration sẽ hỏng vì Prisma bọc file trong
  transaction — phải tách hai migration.
- Phải nới hai ràng buộc kiểm tra hình dạng bút toán và cập nhật bảng tổ hợp hợp lệ (7 → 9).
- Chốt chặn hoàn tiền hai lần (FR-025) hiện thực bằng unique index `(nguồn, loại)` — đây chính
  là lý do FR-029 đòi **loại riêng** chứ không dùng chung một loại hai chiều.
- Ràng buộc "phải có người thực hiện + lý do" hiện đang áp cứng cho một nhóm loại bút toán; thêm
  loại hoàn tiền vào đó phải viết theo điều kiện để không chặn nhầm trường hợp tự huỷ (FR-031).
- FR-007 và FR-016 đòi cùng một row lock trên hồ sơ nhà phát hành. FR-025a đòi **thêm** một row
  lock nữa trên chính đơn rút tiền — không có nó thì hai lệnh huỷ song song cùng đọc thấy "chờ
  duyệt", và cái thứ hai vấp unique index → lỗi hệ thống, vi phạm SC-009.
- FR-016a đòi thứ tự: **nhận diện yêu cầu lặp TRƯỚC phép kiểm 24 giờ**, rồi kiểm lại lần nữa sau
  khi giành được khoá. Giống đúng hai chốt ở `order.service.ts:95` và `:214`.

**RÀNG BUỘC VỀ TEST — đọc trước khi lập danh sách việc:**

**KHÔNG commit unit test nào import service của module này.** Lý do nằm trong commit `5b69ebd`
(PR #50): hai file test của module order bị gỡ vì chúng chạm tới `config.ts` qua service mà chúng
import, và `config.ts` gọi `process.exit(1)` khi biến môi trường thiếu — **giết luôn CI trước khi
image được build**. Các module tiền (order, wallet, system-setting, entitlement) đều KHÔNG có test
committed, đó là chủ ý chứ không phải thiếu sót.

Cách verify của spec 011 là mẫu nên theo: chạy trên `dist` (không phải `start:dev`, vì tsx không
emit decorator metadata nên DTO không được validate), gọi HTTP thật, kiểm database trực tiếp. Test
thuần hàm không import service thì an toàn, nhưng phần lớn giá trị ở đây nằm ở luồng có transaction.

**CÔNG THỨC ĐỐI SOÁT — bản đúng (FR-032):**

Công thức một-số-hạng từng được nêu trong lúc thảo luận là **SAI**, đừng dùng:

```
SAI:  tiền mặt + tự phát hành − (WITHDRAWAL − WITHDRAWAL_REVERSAL) = nợ người dùng + ví sàn
```

Nó coi lúc tạo đơn là lúc tiền rời hệ thống, nên báo thiếu số tiền công ty đang thực giữ, đúng
bằng tổng các đơn chưa chi. Bản đúng tách làm hai túi:

```
ĐÚNG: tiền mặt + tự phát hành − đã chi thật
        = nợ người dùng + ví sàn + đang chờ chi

  đã chi thật   = tổng số tiền các đơn ở trạng thái đã chi tiền
  đang chờ chi  = tổng số tiền các đơn ở trạng thái chờ duyệt hoặc đã duyệt
```

Kiểm lại ở cả ba bước chuyển: **tạo đơn** (nợ người dùng giảm X, đang chờ chi tăng X — vế phải
không đổi, vế trái không đổi); **huỷ đơn** (ngược lại); **chi tiền** (đang chờ chi giảm X, đã chi
thật tăng X — cả hai vế cùng giảm X). Trên production hiện tại cả hai túi đều bằng 0 nên đẳng thức
quy về đúng dạng cũ của spec 011.
