# Data Model: Nạp tiền cho user qua Sepay

**Input**: `spec.md` Key Entities (FR-008, FR-009, FR-004, FR-006) + `research.md` §4-5

## Profile (cập nhật entity có sẵn — `prisma/schema.prisma`, `src/entities/profile.model.ts`)

| Field     | Type                   | Ghi chú                                                        |
|-----------|------------------------|------------------------------------------------------------------|
| `balance` | `BigInt`, default `0`  | Số dư hiện tại (VND). FR-008/FR-009. Chỉ tăng trong tính năng này; cơ chế trừ thuộc tính năng khác, không sửa field này trực tiếp bằng tay — chỉ qua service xử lý top-up. |

Migration: thêm cột `balance BigInt NOT NULL DEFAULT 0`, không cần backfill riêng (default
áp dụng cho user hiện có — đúng FR-008).

## TopUpTransaction (entity mới)

Đại diện cho **một giao dịch ngân hàng Sepay báo về** — dù đã khớp được user hay chưa.
Là nguồn sự thật duy nhất để đối soát `Profile.balance` (research.md §5).

| Field              | Type                        | Ghi chú |
|--------------------|------------------------------|---------|
| `id`               | `uuid`                       | PK |
| `userId`           | `uuid`, nullable             | NULL khi `status = UNMATCHED` (chưa biết của ai) |
| `referenceCode`    | `string`, unique, nullable   | Mã tham chiếu cấp cho user lúc tạo yêu cầu nạp tiền (FR-001). NULL cho giao dịch tạo ra trực tiếp từ một bản ghi `UNMATCHED` (không có yêu cầu gốc). |
| `requestedAmount`  | `BigInt`, nullable           | Số tiền user khai báo khi tạo yêu cầu. NULL nếu bản ghi được tạo thẳng từ một giao dịch `UNMATCHED` (không có yêu cầu gốc). |
| `receivedAmount`   | `BigInt`, nullable           | Số tiền thực tế đã nhận (FR-003). NULL khi còn ở trạng thái `PENDING` (chưa có tiền về). |
| `providerTransactionId` | `string`, unique, nullable | ID giao dịch Sepay cấp. Là khóa chống cộng trùng (FR-005, research.md §3). NULL khi còn `PENDING` (chưa có giao dịch ngân hàng nào khớp). |
| `status`           | enum `TopUpTransactionStatus` | `PENDING` \| `CREDITED` \| `UNMATCHED` (xem Lifecycle) |
| `rawContent`       | `string`, nullable           | Nội dung chuyển khoản gốc do ngân hàng/Sepay báo về (`content` trong contracts/topup-api.md). NULL khi còn `PENDING` (chưa có giao dịch nào về). **Bắt buộc phải set** khi tạo bản ghi `UNMATCHED` — đây là manh mối duy nhất để nhân viên hỗ trợ tra cứu tay (FR-004), vì v1 không có admin UI/API, chỉ xem trực tiếp DB (plan.md § Scale/Scope). |
| `creditedAt`       | `datetime`, nullable         | Thời điểm số dư được cộng, chỉ có khi `status = CREDITED` |
| `createdAt`        | `datetime`                   | |
| `updatedAt`        | `datetime`, nullable         | |

Không có `deletedAt`: bản ghi là **immutable record** theo FR-006 — không xoá, không sửa
tay; chỉ được chuyển trạng thái đúng một lần bởi service xử lý giao dịch.

### Lifecycle (state transitions)

```
 (user tạo yêu cầu nạp tiền — FR-001)
        │
        ▼
    PENDING ──(giao dịch khớp referenceCode về, FR-002/FR-003)──▶ CREDITED
        │
        └─(hết hạn/user không chuyển khoản)──▶ không có transition — bản ghi ở lại PENDING,
                                                 không tự hết hạn trong v1 (xem Assumptions
                                                 của spec — không có yêu cầu expiry)

 (giao dịch ngân hàng về nhưng KHÔNG khớp referenceCode nào đang PENDING — FR-004)
        │
        ▼
    UNMATCHED (userId/requestedAmount = NULL, tạo thẳng ở trạng thái này, không qua PENDING)
```

- `PENDING → CREDITED`: duy nhất transition hợp lệ của một bản ghi do user tạo. Thực hiện
  trong 1 DB transaction cùng với việc cộng `Profile.balance` (research.md §3).
- Bản ghi `UNMATCHED` không có transition tiếp theo trong v1 (xử lý tay ngoài hệ thống —
  xem Assumptions của spec, không có admin API cho việc này ở v1).
- Không có transition nào quay lại hoặc xoá một bản ghi `CREDITED` — đúng tính chất
  "không thể sửa đổi" của FR-006.

### Validation rules

- `providerTransactionId` phải unique toàn bảng (bất kể status) — là ràng buộc chống cộng
  trùng chính (FR-005).
- `referenceCode` phải unique toàn bảng khi khác NULL — mỗi yêu cầu nạp tiền có mã riêng
  (FR-001).
- `receivedAmount` chỉ được set cùng lúc với việc chuyển `status` sang `CREDITED` hoặc khi
  tạo bản ghi `UNMATCHED`; không set khi còn `PENDING`.
- `rawContent` PHẢI được set cùng lúc với `receivedAmount` (cả khi `CREDITED` lẫn khi tạo
  `UNMATCHED`) — không được bỏ trống ở bản ghi `UNMATCHED`, nếu không FR-004 ("giữ lại để
  xử lý tay") không có dữ liệu nào để tay thực sự xử lý được.
- Cộng `Profile.balance` của đúng `userId` chỉ xảy ra khi và chỉ khi một bản ghi chuyển
  sang `CREDITED` (không có đường nào khác được cộng số dư — giữ `Profile.balance` luôn
  bằng tổng `receivedAmount` của mọi `TopUpTransaction.status = CREDITED` thuộc user đó).

## Quan hệ

- `Profile 1 — 0..n TopUpTransaction` qua `userId` (nullable phía `TopUpTransaction`).
- Không thêm quan hệ Prisma `@relation` bắt buộc hai chiều ngược vào `Profile`/`User` nếu
  không cần query theo chiều đó trong v1 (tránh field thừa trên `User`/`Profile` model,
  theo Nguyên tắc VI) — `userId` đủ để truy vấn theo chiều cần (lấy lịch sử theo user).
