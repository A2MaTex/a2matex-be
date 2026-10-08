# Research: Nạp tiền cho user qua Sepay

**Input**: `specs/002-sepay-wallet-topup/spec.md` (FR-001…FR-011, SC-001…SC-006)

Mục tiêu: chốt các quyết định kỹ thuật cần có trước khi thiết kế data model/contract,
dựa trên cách Sepay thực tế hoạt động và các pattern đã có sẵn trong repo
(`src/routes/profile`, `src/shared/guards`, `src/shared/decorators`).

## 1. Cách Sepay báo giao dịch về hệ thống

**Decision**: Dùng kết hợp 2 kênh — (a) Sepay gọi webhook (HTTP POST) tới một endpoint
của hệ thống ngay khi phát hiện giao dịch chuyển khoản vào tài khoản ngân hàng đã đăng ký
với Sepay, và (b) một job đối soát định kỳ gọi API "liệt kê giao dịch" của Sepay để quét
lại các giao dịch gần đây, nhằm bắt các trường hợp (a) không xảy ra (FR-002, FR-011).

**Rationale**: Sepay không cấp "tài khoản ảo" riêng cho từng merchant/khách hàng — mọi
giao dịch đều đổ về một tài khoản ngân hàng thật duy nhất mà hệ thống đã đăng ký với
Sepay; việc "gắn" một giao dịch cho đúng user dựa vào nội dung chuyển khoản (user được
cấp một mã tham chiếu duy nhất để ghi vào nội dung chuyển khoản — FR-001). Webhook là
kênh chính (đáp ứng SC-001: cập nhật trong 60 giây), nhưng chỉ dựa vào webhook là rủi ro
một chiều (FR-011 yêu cầu rõ phải có đối soát chủ động).

**Alternatives considered**:
- Chỉ dùng webhook, không đối soát: đơn giản hơn nhưng vi phạm trực tiếp FR-011 (đã chốt
  qua `/speckit-clarify`).
- Chỉ dùng polling API, không webhook: đáp ứng được FR-011 nhưng không đạt SC-001 (cập
  nhật trong 60 giây) nếu polling interval dài; polling ngắn (<60s) thì tốn API call/CPU
  không cần thiết so với nhận push qua webhook.

## 2. Xác thực nguồn thông báo (FR-010)

**Decision**: Endpoint webhook là route public (`@IsPublic()`, không qua `AccessTokenGuard`
vì đây không phải request của user đã đăng nhập), nhưng được bảo vệ bằng một guard riêng
kiểm tra một API key dạng shared-secret gửi kèm header `Authorization` — giá trị này do
hệ thống tự cấu hình trong Sepay dashboard và lưu ở biến môi trường, so khớp bằng
constant-time compare. Request thiếu hoặc sai key bị từ chối (401) và được log lại.

**Rationale**: đây là cơ chế xác thực webhook mà Sepay hỗ trợ sẵn (không có HMAC ký theo
payload); theo đúng FR-010, đây là lớp xác thực duy nhất và bắt buộc trước khi dữ liệu
chạm vào business logic — phù hợp Nguyên tắc I của constitution (Schema-Validated
Boundaries) vì vẫn validate payload bằng Zod sau khi qua xác thực. Việc khóa IP nguồn
(IP allowlist) không được chọn làm cơ chế chính vì Sepay có thể đổi IP gửi webhook mà
không báo trước; vẫn có thể bổ sung sau nếu cần, không phải tiền đề của kiến trúc.

**Alternatives considered**:
- Chỉ allowlist theo IP: dễ vỡ khi Sepay đổi hạ tầng, không có cách merchant tự xác minh.
- Không xác thực (dựa vào obscurity của URL endpoint): vi phạm trực tiếp FR-010.

## 3. Đảm bảo không cộng trùng (FR-005)

**Decision**: Mỗi giao dịch ngân hàng có một `providerTransactionId` (ID giao dịch do
Sepay cấp) được lưu với ràng buộc **unique** ở tầng database. Xử lý một giao dịch đến
(webhook hoặc đối soát) PHẢI kiểm tra tồn tại theo `providerTransactionId` trước, và việc
ghi nhận + cộng số dư PHẢI nằm trong một database transaction duy nhất (dùng
`@Transactional` đã có sẵn trong `src/shared/decorators/transactional.decorator.ts`).
Đồng thời dùng `@DistributedLock` (đã có sẵn, dùng cho `profile.service.ts`) khóa theo
`providerTransactionId` trong lúc xử lý để tránh hai request xử lý đồng thời cùng một
giao dịch (ví dụ webhook và job đối soát chạy trùng thời điểm).

**Rationale**: ràng buộc unique ở DB là nguồn sự thật cuối cùng, không thể bị race
condition vượt qua (khác với chỉ dùng lock ở application layer); lock chỉ là tối ưu để
tránh retry/exception không cần thiết, không phải cơ chế đảm bảo chính.

**Alternatives considered**:
- Chỉ dùng `@DistributedLock`, không có unique constraint: không an toàn nếu lock hết TTL
  hoặc hai instance app không chia sẻ cùng Redis.

## 4. Biểu diễn số dư (FR-008, FR-009)

**Decision**: Thêm field `balance BigInt @default(0)` vào `Profile`, đơn vị VND (số
nguyên, không có phần thập phân). `requestedAmount`/`receivedAmount` trên giao dịch nạp
tiền cũng dùng `BigInt`.

**Rationale**: VND không có đơn vị nhỏ hơn đồng, nên không cần `Decimal`; `BigInt` tránh
hoàn toàn sai số dấu phẩy động của `number`/`float`, và đã có tiền lệ dùng `BigInt` trong
schema hiện tại (`Static.size`). Không cần giới hạn độ lớn kiểu `Int` (tối đa ~2.1 tỷ) vì
số dư tích lũy có thể vượt mốc này theo thời gian.

**Alternatives considered**: `Decimal`/`Numeric` — an toàn tương đương nhưng thừa cho một
đơn vị tiền không có phần thập phân; thêm độ phức tạp không cần thiết (Nguyên tắc VI —
Simplicity/YAGNI).

## 5. Lưu trữ giao dịch chưa khớp được user (FR-004)

**Decision**: Không tạo entity riêng cho "giao dịch chưa khớp". Dùng cùng bảng
`TopUpTransaction`, với `userId`/`requestedAmount` nullable và `status = UNMATCHED` cho
các giao dịch ngân hàng không khớp được mã tham chiếu nào.

**Rationale**: tránh một entity trùng lặp khái niệm (Nguyên tắc VI); mọi giao dịch ngân
hàng Sepay báo về — khớp được hay không — đều là cùng một khái niệm nghiệp vụ
("một lần tiền từ Sepay đổ vào"), chỉ khác ở trạng thái.

**Alternatives considered**: bảng `UnmatchedBankTransaction` riêng — rõ ràng hơn về mặt
đặt tên nhưng tạo thêm một entity + migration + chỗ để đồng bộ logic unique-by-
`providerTransactionId`, không cần thiết ở quy mô hiện tại.

## 6. Cơ chế đối soát chủ động (FR-011)

**Decision**: Thêm dependency `@nestjs/schedule`, dùng `@Cron()` chạy một job định kỳ (mặc
định mỗi 15 phút, cấu hình qua biến môi trường) gọi API liệt kê giao dịch của Sepay cho
khoảng thời gian gần nhất, rồi tái sử dụng đúng logic xử lý giao dịch đã dùng cho webhook
(cùng một service method) cho mỗi giao dịch trả về.

**Rationale**: 15 phút vẫn nằm sâu trong ngưỡng SC-006 (tối đa 24 giờ); dùng lại logic xử
lý của webhook (thay vì viết logic riêng) tránh hai nơi có thể lệch nhau trong việc xác
định "giao dịch này đã được xử lý chưa" — đúng với tinh thần FR-005 áp dụng cho cả hai
kênh. Không cần thêm message queue/broker (Redis đã có nhưng chỉ dùng cho cache/lock) vì
tần suất và khối lượng giao dịch hiện tại không đòi hỏi xử lý bất đồng bộ phức tạp hơn một
cron job trong chính NestJS process (Nguyên tắc VI).

**Alternatives considered**: BullMQ/queue riêng cho reconciliation — over-engineering ở
quy mô hiện tại, thêm một dependency + một process vận hành mới không có nhu cầu cụ thể.

**Cập nhật sau khi xác minh với tài khoản Sepay thật (2026-10-08)**: giả định ban đầu
("API liệt kê giao dịch trả về cùng shape với webhook") **sai**. `GET
/userapi/transactions/list` trả về shape khác hẳn — snake_case, tách riêng
`amount_in`/`amount_out` thay vì `transferAmount`+`transferType`, field tên khác
(`bank_brand_name`, `transaction_date`, `transaction_content`, `account_number`...). Đã
thêm bước map riêng trong `sepay-api.client.ts` (`SepayTransactionListItem` → chuẩn hoá
sang đúng shape `SepayWebhookPayload` trước khi gọi `handleIncomingTransaction`), xác
minh bằng cách gọi trực tiếp API thật với token thật và đối chiếu response mẫu.

## 7. Hiển thị số dư trên Profile (FR-007)

**Decision**: Mở rộng `ProfileOutput` (zod schema trong `src/routes/profile/profile.model.ts`)
để trả thêm field `balance`; không tạo endpoint riêng — tái dùng `GET /profiles/me` đã có.

**Rationale**: đúng yêu cầu gốc của user ("số tiền được nạp sẽ được hiển thị dựa vào 1
field trong bảng profile") và tránh một endpoint trùng lặp thông tin.
