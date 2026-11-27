# Research: Quản trị viên duyệt đơn rút tiền và xem sổ cái

**Phase 0** · 2026-11-27 · [plan.md](./plan.md) · [spec.md](./spec.md)

Không có `NEEDS CLARIFICATION` nào — 8 quyết định nghiệp vụ chốt trực tiếp với chủ repo, 2 câu rẽ
nhánh đã hỏi. Dưới đây là quyết định **kỹ thuật**.

---

## R1 — Không migration, không đụng lược đồ

**Decision**: spec này không thêm bảng, cột, enum hay ràng buộc nào.

**Rationale**: spec 012 đã khai sẵn đủ 5 giá trị trạng thái và bốn cột `bankTransferRef`,
`rejectionReason`, `processedById`, `processedAt` — đúng vì biết trước lát cắt này sẽ tới. Ba ràng
buộc nhất quán trạng thái cũng đã có và **đang ép đúng cái spec này cần**:

| Ràng buộc | Ép điều gì | FR tương ứng |
|---|---|---|
| `WithdrawalRequest_processed_check` | rời `PENDING` thì `processedAt` phải có | FR-010, FR-017 |
| `WithdrawalRequest_transferRef_check` | `bankTransferRef` chỉ có khi `PAID` | FR-015 |
| `WithdrawalRequest_rejection_check` | `rejectionReason` chỉ có khi `REJECTED` | FR-021 |

Code phải **viết thuận theo** ba ràng buộc này. Mỗi câu `UPDATE` đổi trạng thái phải đặt đúng bộ
cột đi kèm trong cùng câu lệnh, nếu không sẽ vi phạm ràng buộc và thành lỗi hệ thống.

---

## R2 — Ba lần đổi trạng thái đều là một câu `UPDATE` có điều kiện

**Decision**: mỗi thao tác là **một** câu lệnh, điều kiện trạng thái nằm trong `WHERE`:

```sql
-- duyệt
UPDATE "WithdrawalRequest"
   SET status='APPROVED', "processedAt"=now(), "processedById"=$admin
 WHERE id=$id AND status='PENDING' RETURNING …

-- đánh dấu đã chi
UPDATE "WithdrawalRequest"
   SET status='PAID', "processedAt"=now(), "processedById"=$admin, "bankTransferRef"=$ref
 WHERE id=$id AND status='APPROVED' RETURNING …

-- từ chối (nhận HAI trạng thái nguồn, FR-018)
UPDATE "WithdrawalRequest"
   SET status='REJECTED', "processedAt"=now(), "processedById"=$admin, "rejectionReason"=$reason
 WHERE id=$id AND status IN ('PENDING','APPROVED') RETURNING id, amount, "publisherUserId"
```

**Rationale**: khuôn của spec 012 R8, đã chứng minh bằng thực nghiệm. Không có phép đọc riêng
trước khi ghi ⇒ không có cửa sổ cho lệnh song song chen vào. Dưới `READ COMMITTED`, lệnh thứ hai
chặn ở khoá dòng, đánh giá lại `WHERE` sau khi lệnh đầu commit, khớp 0 dòng, và nhận câu trả lời
nghiệp vụ. Điều này phủ **cả bốn** cặp đua mà FR-038 và SC-004 đòi: duyệt×duyệt, từ chối×từ chối,
duyệt×từ chối, và duyệt×nhà-phát-hành-tự-huỷ (vì `cancelIfPending` cũng cùng khuôn).

`RETURNING` trả luôn `amount` và `publisherUserId` cho đường từ chối, nên không cần đọc lại để
biết hoàn bao nhiêu cho ai.

**Alternatives considered**: `SELECT ... FOR UPDATE` rồi kiểm trạng thái trong mã nguồn. Chạy đúng
nhưng tính đúng đắn phụ thuộc vào việc nhớ đặt `FOR UPDATE` — spec 012 đã loại vì cùng lý do.

---

## R3 — Phân biệt 404 và 409 bằng một phép đọc **sau** khi đã ghi

**Decision**: khi câu `UPDATE` khớp 0 dòng, đọc lại đơn **chỉ để chọn thông điệp lỗi**: không tồn
tại ⇒ không tìm thấy; tồn tại nhưng sai trạng thái ⇒ xung đột trạng thái, và thông điệp nêu rõ
trạng thái hiện tại.

**Rationale**: tới thời điểm đó tính đúng đắn đã xong, phép đọc không còn ảnh hưởng gì. Spec 012
dùng đúng cách này ở đường huỷ. Nêu trạng thái hiện tại trong lỗi là cần thiết vì quản trị viên có
ba thao tác với ba điều kiện khác nhau — "không đúng trạng thái" trơ trụi không nói họ phải làm gì.

---

## R4 — Chỉ đường **từ chối** khoá `Profile`; duyệt và đánh dấu chi thì không

**Decision**:

| Thao tác | Khoá |
|---|---|
| Duyệt | chỉ dòng `WithdrawalRequest` (do chính câu `UPDATE` giữ) |
| Đánh dấu đã chi | chỉ dòng `WithdrawalRequest` |
| Từ chối | `Profile` **trước**, rồi dòng `WithdrawalRequest` |

**Rationale**: duyệt và đánh dấu chi **không đụng số dư** (FR-011, FR-016), nên khoá `Profile` ở
đó là giữ một khoá không dùng tới.

**Phân tích chu trình khoá** — phải làm, vì đây là nơi dễ tạo deadlock nhất:

- Từ chối giữ `Profile` rồi xin dòng `WithdrawalRequest`.
- Duyệt / đánh dấu chi giữ dòng `WithdrawalRequest` và **không bao giờ xin `Profile`**.
- Nhà phát hành tự huỷ (spec 012) giữ `Profile` rồi xin dòng `WithdrawalRequest` — **cùng chiều**
  với đường từ chối.

Không có đường nào đi ngược chiều ⇒ không có chu trình ⇒ không deadlock. Thứ tự "Profile trước"
vẫn được giữ nguyên ở mọi đường **có** đụng cả hai, đúng kỷ luật toàn cục của order/wallet/withdrawal.

**Hệ quả phải nhớ**: nếu sau này ai thêm việc đụng số dư vào đường duyệt, họ **phải** thêm khoá
`Profile` lên trước câu `UPDATE`, nếu không sẽ tạo đúng chu trình vừa loại bỏ.

---

## R5 — Ràng buộc "ai làm, vì sao" cho khoản hoàn tiền chỉ ép được ở tầng ứng dụng

**Decision**: `WalletTransaction_actor_check` **giữ nguyên**. FR-023 (khoản hoàn do quản trị viên
từ chối phải có người thực hiện và lý do) được ép ở tầng ứng dụng.

**Rationale**: ràng buộc đó nằm trên `WalletTransaction` và **không thể nhìn sang** trạng thái của
`WithdrawalRequest` để biết khoản hoàn này do quản trị viên từ chối hay do nhà phát hành tự huỷ.
Một ràng buộc có điều kiện như vậy đòi trigger, mà repo chưa có trigger nào và thêm một cái chỉ vì
việc này là trừu tượng hoá sớm.

Cách ép ở tầng ứng dụng: `AdminWithdrawalService` là **nơi duy nhất** gọi `recordWithdrawalReversal`
kèm `createdById` + `note`, và DTO bắt buộc có lý do không rỗng. Hai đường sinh khoản hoàn (tự huỷ
và bị từ chối) nằm ở hai service khác nhau nên không lẫn vào nhau được.

**Alternatives considered**: thêm cột `rejectedById` riêng trên `WalletTransaction` để ràng buộc
nhìn thấy — thêm một cột chỉ để phục vụ một ràng buộc, trong khi `createdById` đã mang đúng thông
tin đó.

---

## R6 — Phân tách nguồn gốc ví: gộp theo loại, cả hai chiều

**Decision**: một truy vấn `GROUP BY type, direction` trên bút toán của người đó, rồi tầng ứng
dụng xếp thành hai nhóm vào/ra. Bảng phải **tự cân** (FR-030a):

```
(TOPUP + EARNING + ADMIN_GRANT + WITHDRAWAL_REVERSAL)   ← vào
− (PURCHASE + WITHDRAWAL)                               ← ra
= số dư hiện tại
```

**Rationale**: đây chính là đẳng thức mà phép đối soát (a) đang dùng, chỉ khác là tách ra từng
loại thay vì gộp một số. Nên nếu bảng này **không** cân thì phép đối soát (a) cũng đang báo lệch
cho ví đó — hai con số nhất quán với nhau theo định nghĩa, không phải trùng hợp.

`WITHDRAWAL_REVERSAL` phải nằm ở nhóm **vào**: bỏ sót nó sẽ làm mọi ví từng có đơn bị từ chối hiện
ra là lệch.

---

## R7 — Bảng đối soát chạy đúng sáu truy vấn của tài liệu vận hành

**Decision**: lấy nguyên sáu truy vấn ở mục B9.3 của `docs/deployment-runbook.md`: năm phép kiểm
phải ra 0 dòng — (a) ví người dùng, (b) ví sàn, (c) đơn hàng, (d) chuyển khoản, (f) đơn rút tiền —
cộng phép (e) là bảng dòng tiền.

Đẳng thức dùng **dạng hai túi** (FR-034):

```
tiền mặt vào + tự phát hành − đã chi thật
    = nợ người dùng + ví sàn + đang chờ chi
```

**Rationale**: SC-009 đòi số liệu khớp **tuyệt đối** với kết quả chạy tay. Cách chắc chắn nhất là
dùng đúng câu truy vấn, không viết lại.

**Về "chỉ đích danh" (FR-036)**: bốn phép (a)(b)(c)(d) vốn trả về dòng vi phạm, nên API trả luôn
danh sách đó thay vì chỉ đếm. Phép (f) so hai tổng nên không có dòng nào để nêu — trả cả hai con
số và hiệu của chúng.

**Cảnh báo chi phí**: sáu truy vấn quét toàn bảng, có phép `GROUP BY` trên toàn bộ `Profile` và
`WalletTransaction`. Ở quy mô hiện tại (10 ví, vài chục bút toán) là không đáng kể, nhưng đây là
route đắt nhất của hệ thống và sẽ xấu dần theo dữ liệu. Chấp nhận bây giờ; khi chậm thì việc đúng
là chạy định kỳ và lưu kết quả, không phải cache.

---

## R8 — Lọc sổ cái: ba bộ lọc độc lập, kết hợp bằng AND

**Decision**: lọc theo người dùng, theo loại biến động, theo khoảng thời gian; bỏ trống nghĩa là
không lọc theo tiêu chí đó. Khoảng thời gian kiểm bắt-đầu ≤ kết-thúc ở tầng DTO (FR-029).

Sắp xếp `createdAt` giảm dần, **kèm `id` làm tiêu chí phụ** (FR-027): `createdAt` mặc định `now()`
tức thời điểm mở transaction, nên ba bút toán của cùng một đơn hàng mang **cùng một mốc** — không
có tiêu chí phụ thì chúng xếp tuỳ ý và lật trang sẽ trùng hoặc sót. Cùng quy ước `order.repo.ts`
và `wallet.repo.ts` đang dùng.

**Bộ lọc theo loại nhận nhiều giá trị**, vì câu hỏi thực tế của quản trị viên là "cho tôi xem mọi
khoản tiền tôi đã cộng tay" — tức `ADMIN_GRANT` và `ISSUED_CREDIT` cùng lúc.

---

## R9 — Hai controller quản trị đặt vào module đã có

**Decision**: `admin-withdrawal.controller.ts` vào `src/routes/withdrawal/`; ba route đọc sổ cái
thêm vào `admin-wallet.controller.ts` **sẵn có** trong `src/routes/wallet/`.

**Rationale**: đúng khuôn repo — `admin-wallet.controller.ts` nằm trong `wallet/`,
`admin-entitlement.controller.ts` nằm trong `entitlement/`. Controller nằm cạnh repo và service nó
dùng. Dựng một module `admin/` riêng sẽ tách chúng ra mà không được lợi gì.

`AdminWalletService` phải được `wallet-core.module.ts` export vì `WalletModule` chỉ mang
controller — cùng đường mà `WalletService` đang đi.

**Hệ quả phải kiểm**: `wallet-core.module.ts` **không được** kéo theo controller nào, vì
`CronModule` nhận nó qua `TopUpCoreModule`, và bất cứ controller nào lọt vào đường đó sẽ phục vụ
route trên cổng cron.

---

## R10 — Gác quyền thật, và lần deploy này phải chạy seed

**Decision**: bảy route **không** dùng `@SkipPermissionCheck()`. Theo khuôn
`AdminEntitlementController`.

**Rationale**: route của nhà phát hành ở spec 012 tự lọc theo danh tính người gọi nên bỏ qua gác
quyền được. Ở đây **không có danh tính nào để lọc** — chúng đọc và sửa dữ liệu của người khác, nên
gác quyền theo vai trò là chốt chặn duy nhất.

`create-permissions.ts` quét AST nên bản ghi quyền tự sinh và tự cấp cho ADMIN. Nhưng khác spec
012, lần deploy này **bắt buộc chạy seed**, nếu không bảy route trả 403 cho cả quản trị viên.

Thao tác đó xoá cache phân quyền không có hạn dùng — thứ từng làm lộ sự cố 403 ngày 2026-11-23.
Đã kiểm ngày 2026-11-27: 6 khoản cấp quyền của vai trò không phải ADMIN đang bị xoá mềm đều là
**tên route cũ đã biến mất**, không khoản nào đang mất mà bị cache che. Nên chạy bây giờ an toàn.

---

## R11 — Cách verify, và phần test nào commit được

**Decision**: viết đầy đủ và **commit TẤT CẢ**, kể cả test import service.

**Rationale** — tiền đề của spec 012 là **SAI**, code review bắt được. Spec 012 kết luận "test
import service không commit được vì chạm `config.ts`", nhưng `project.service.spec.ts` **đang nằm
trong git** và import `ProjectService` thật: nó chặn chuỗi dẫn tới config bằng `vi.mock`.

Làm theo cách đó thì test của spec này cũng chạy được khi **không có `.env`** — đã kiểm bằng cách
tạm đổi tên `.env` rồi chạy vitest: 41/41 xanh. Cần mock đúng bốn thứ:

```ts
vi.mock('…/shared/constants/system.constant.ts', …);  // getPagination kéo vào
vi.mock('…/withdrawal.repo.ts', …);                   // PrismaService
vi.mock('…/wallet/wallet.repo.ts', …);                // PrismaService
vi.mock('…/shared/services/transaction.service.ts', …);
```

Thủ phạm thật không phải `system.constant.ts` mà là **`PrismaService`** — mọi repo đều kéo nó, và
nó nạp `config.ts`.

**Hệ quả cho spec 012**: 15 test service của nó đang nằm ngoài git một cách không cần thiết. Nên
đưa vào bằng cùng cách này, nhưng đó là việc riêng, không thuộc spec này.

Ngoài ra vẫn verify trên `dist` + HTTP thật + truy vấn database, **bắt buộc chạy trên `dist`** vì
`tsx` không emit decorator metadata nên DTO không được validate.

**Dựng dữ liệu**: DB local đã có sẵn publisher `pub012@example.com` (mật khẩu `Secret123!`) và
Term `PUBLISHER_TERMS` từ lần verify spec 012. Ca song song cần nhiều đơn ở nhiều trạng thái.
