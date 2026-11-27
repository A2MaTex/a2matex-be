# Research: Tạo đơn rút tiền cho nhà phát hành

**Phase 0** · 2026-11-27 · [plan.md](./plan.md) · [spec.md](./spec.md)

Không có `NEEDS CLARIFICATION` nào từ Technical Context — 16 quyết định nghiệp vụ đã chốt trực
tiếp với chủ repo trước khi viết spec. Phần dưới là các quyết định **kỹ thuật** phải chốt trước
khi thiết kế dữ liệu.

---

## R1 — Hai migration riêng cho giá trị enum

**Decision**: tách thành hai file migration. File 1 **chỉ** chứa `ALTER TYPE ... ADD VALUE`. File 2
chứa bảng, cột, ràng buộc và index.

**Rationale**: Prisma bọc mỗi file migration trong một transaction. PostgreSQL không cho dùng một
giá trị enum vừa thêm trong cùng transaction đã thêm nó (`unsafe use of new value of enum type`).
Ràng buộc `WalletTransaction_accountKind_check` ở file 2 có nhắc tên hai giá trị mới, nên nếu gộp
một file thì migration gãy.

**Alternatives considered**:
- `ALTER TYPE ... ADD VALUE` kèm chú thích chạy ngoài transaction — Prisma không có cơ chế đánh
  dấu file "no-transaction", nên không làm được.
- Dùng `TEXT` + `CHECK` thay enum — đổi kiểu một cột đang có dữ liệu production, rủi ro lớn hơn
  nhiều so với việc tách hai file.

---

## R2 — Thứ tự khoá: **Profile luôn trước**

**Decision**: mọi đường trong module này khoá `Profile` của nhà phát hành **trước tiên**. Đường huỷ
đơn khoá `Profile` rồi mới khoá dòng `WithdrawalRequest`.

**Rationale**: đây là kỷ luật đã có sẵn và đã trả giá để học. `wallet.service.ts:grantToUser` mang
comment dài giải thích đúng chuyện này: khoá `SystemAccount` trước `Profile` sẽ deadlock 40P01 với
luồng mua hàng (`order.service.ts:200` khoá `Profile` theo `userId` tăng dần). Thêm một thứ tự
khoá thứ ba vào hệ thống là tự tạo ra lớp lỗi đó lần nữa.

Khoá `Profile` cũng **đủ** để thoả FR-007, FR-016 và FR-025a cùng lúc, vì cả ba đều là tranh chấp
**trong phạm vi một nhà phát hành**:
- FR-007 (số dư) — hai lệnh tạo đơn của cùng người xếp hàng
- FR-016 (mốc 24 giờ) — cùng lý do
- FR-025a (huỷ trùng) — chỉ chủ đơn huỷ được (FR-036), nên hai lệnh huỷ luôn cùng một `Profile`

**Alternatives considered**:
- Khoá `WithdrawalRequest` trước rồi `Profile` ở đường huỷ: tạo chu trình khoá với đường tạo đơn
  (tạo đơn giữ `Profile` và đọc `WithdrawalRequest`; huỷ giữ `WithdrawalRequest` và đợi `Profile`)
  → deadlock.
- Chỉ dựa vào unique index để chặn huỷ trùng: vi phạm SC-009, vì lỗi ràng buộc nổi lên thành lỗi
  hệ thống chứ không phải câu trả lời nghiệp vụ.

---

## R3 — Phép kiểm mốc 24 giờ không tự khoá dòng nào

**Decision**: kiểm bằng `SELECT max("createdAt") FROM "WithdrawalRequest" WHERE "publisherUserId" = ...`,
**không** `FOR UPDATE`, và chạy **sau** khi đã giữ khoá `Profile`.

**Rationale**: khoá `Profile` đã serialize mọi lần tạo đơn của người đó, nên không có ai khác chen
vào giữa phép đọc và phép ghi. Thêm `FOR UPDATE` lên `WithdrawalRequest` ở đây sẽ tạo đúng chu
trình khoá mà R2 vừa loại bỏ.

Mốc neo là `createdAt` của đơn gần nhất, không phải `updatedAt` hay thời điểm xử lý (FR-013), và
đếm **mọi** đơn bất kể trạng thái (FR-014) — nên câu truy vấn không có mệnh đề lọc trạng thái nào.

**Phép so sánh phải dùng `now()` của database, không dùng đồng hồ của ứng dụng.** `createdAt` do
Postgres ghi; so nó với `new Date()` trong mã nguồn là so hai đồng hồ khác nhau, mà container ứng
dụng và Cloud SQL lệch nhau được. Lệch vài giây ở ranh giới 24 giờ sẽ cho qua một đơn lẽ ra bị
chặn, hoặc ngược lại. Lấy cả hai giá trị trong **một** câu truy vấn:

```sql
SELECT max("createdAt") AS last_created,
       now()            AS db_now,
       max("createdAt") + interval '24 hours' AS next_allowed
FROM "WithdrawalRequest" WHERE "publisherUserId" = $1;
```

`next_allowed` cũng chính là thời điểm phải trả về cho người dùng theo FR-015.

---

## R3a — Vì sao mức tối thiểu cấu hình được mà mốc 24 giờ thì không

**Decision**: `WITHDRAWAL_MIN_AMOUNT` nằm ở `SystemSetting` (admin đổi được), còn
`WITHDRAWAL_COOLDOWN_HOURS = 24` là hằng số trong mã nguồn.

**Rationale**: FR-011 **bắt buộc** mức tối thiểu phải đổi được mà không deploy lại — đó là chính
sách thương mại, admin cân theo chi phí chuyển khoản. Mốc 24 giờ là luật chống lạm dụng, spec
không đòi cấu hình được, và thêm một khoá setting thứ hai chỉ vì "cho đối xứng" là vi phạm Nguyên
tắc VI.

Bất đối xứng này **cố ý**, ghi ra đây để người đọc sau không tưởng là bỏ sót. Nếu sau này cần cho
đổi, đó là một khoá registry mới cộng một chỗ đọc — không phải đổi thiết kế.

---

## R4 — Chống lặp: hai chốt, chốt đầu chạy trước mọi quy tắc nghiệp vụ

**Decision**: sao chép nguyên hình dạng của `order.service.ts`:
1. Probe `findByIdempotencyKey` **trước khi mở transaction** (`order.service.ts:95`) → nếu có, trả
   về đơn cũ ngay.
2. Probe lại **sau khi đã giữ khoá `Profile`** (`order.service.ts:214`).
3. Trong `catch`, probe lần nữa trước khi ném lỗi (`order.service.ts:103`).

**Rationale**: FR-016a đòi nhận diện lặp **trước** phép kiểm 24 giờ. Chốt 1 làm đúng việc đó. Chốt
3 là thứ tinh tế mà luồng mua hàng đã học được và ghi lại thành comment: request thua cuộc trong
một cặp chạy song song **hiếm khi** vấp vào chính khoá chống lặp — nó thường vấp một quy tắc
nghiệp vụ trước (ở đây là "chưa đủ 24 giờ" hoặc "không đủ số dư"), nên phải probe lại trong
`catch` thì mới trả đúng câu trả lời lặp thay vì một lỗi nghiệp vụ gây hiểu nhầm.

So sánh "cùng nội dung" theo FR-034 gồm **bốn** trường: số tiền, số tài khoản, tên ngân hàng, tên
chủ tài khoản. Luồng mua hàng chỉ so một trường (`productOfferId`) vì đơn hàng chỉ có một tham số;
đơn rút tiền có bốn — và bốn trường so tay là chỗ dễ sót nhất của cả module.

**Cách chặn sót ở tầng kiểu**: khai **một** type `WithdrawalClaim` gồm đúng bốn trường đó, và dùng
nó ở **cả hai** nơi — dựng dòng để `INSERT`, và dựng lại từ dòng đã đọc để so sánh:

```ts
type WithdrawalClaim = {
  amount: bigint;
  bankAccountNumber: string;
  bankName: string;
  bankAccountHolder: string;
};

const toClaim = (row: WithdrawalRow): WithdrawalClaim => ({ … });
const sameClaim = (a: WithdrawalClaim, b: WithdrawalClaim) =>
  a.amount === b.amount &&
  a.bankAccountNumber === b.bankAccountNumber &&
  a.bankName === b.bankName &&
  a.bankAccountHolder === b.bankAccountHolder;
```

Thêm một trường vào `WithdrawalClaim` sẽ làm **TypeScript báo lỗi ở cả chỗ `INSERT` lẫn chỗ
`toClaim`**, nên không thể thêm trường mà quên đưa vào phép so. Viết `sameClaim` so thiếu trường
thì vẫn biên dịch được — nhưng đó là cố ý xoá một dòng, không phải quên, và `sameClaim` nằm một
chỗ duy nhất nên code review nhìn thấy ngay.

**Alternatives considered**: thêm cột `requestFingerprint` lưu băm của payload rồi so một giá trị.
Chống sót tốt tương đương, nhưng tốn một cột, một hàm băm và một quy ước chuẩn hoá JSON — vi phạm
Nguyên tắc VI khi phương án kiểu dữ liệu đã đủ.

---

## R5 — Hình dạng khoá `WITHDRAWAL_MIN_AMOUNT`

**Decision**: `{ amount: <chuỗi thập phân> }`, parse sang `BigInt` khi đọc. Giá trị khởi tạo
`"100000"`.

**Rationale**: số tiền trong toàn hệ thống là `BigInt`; để mức tối thiểu là `number` tạo ra một
chỗ duy nhất tiền sống dưới dạng số thực, và phép so `amount >= BigInt(min)` sẽ phải ép kiểu qua
lại. `COMMISSION_RATE_BPS` dùng `z.number().int()` được vì basis point có trần 10000, không phải
tiền.

Schema **phải kiểm trần `BIGINT`**, không dùng `^\d{1,19}$` trần trụi: regex đó cho qua
`9999999999999999999` vượt trần `BIGINT` → PostgreSQL 22003 → **500**. Đây là lỗi thật đã tìm ra
ở code review spec 011.

**Alternatives considered**: hằng số trong mã nguồn — vi phạm FR-011 (admin phải đổi được mà không
deploy lại), và lặp lại đúng thứ spec 009 sinh ra để loại bỏ.

---

## R6 — `WalletTransaction_source_check` phải sửa **mọi** nhánh, không chỉ thêm nhánh mới

**Decision**: khi thêm cột `withdrawalRequestId`, viết lại toàn bộ ràng buộc để **mỗi nhánh cũ**
cũng khẳng định `"withdrawalRequestId" IS NULL`.

**Rationale**: ràng buộc hiện tại (migration `20261125100000` dòng 82) liệt kê từng loại kèm
nguồn chứng từ được phép. Nếu chỉ thêm một nhánh cho hai loại mới mà không đụng các nhánh cũ, thì
một dòng `ADMIN_GRANT` hoàn toàn có thể mang `withdrawalRequestId` và ràng buộc vẫn cho qua — đúng
thứ ràng buộc đó sinh ra để chặn. Đây là bẫy im lặng: không test nào fail, chỉ dữ liệu bẩn dần.

Cùng lý do cho `WalletTransaction_accountKind_check`: thêm hai nhánh
`(WITHDRAWAL, DEBIT, USER)` và `(WITHDRAWAL_REVERSAL, CREDIT, USER)`, và cập nhật bản sao ở tầng
ứng dụng `WALLET_ENTRY_SHAPES` từ 7 lên **9** tổ hợp.

---

## R7 — `WalletTransaction_actor_check` phải viết có điều kiện

**Decision**: giữ nguyên yêu cầu "có người thực hiện + lý do" cho `ADMIN_GRANT` / `ISSUED_CREDIT`,
và **không** thêm `WITHDRAWAL_REVERSAL` vào danh sách áp cứng đó.

**Rationale**: FR-031. Lát cắt này chỉ sinh ra reversal **do nhà phát hành tự huỷ**, không có quản
trị viên nào để điền. Thêm loại đó vào danh sách áp cứng sẽ chặn đúng đường đang làm. Ràng buộc
chặt hơn cho trường hợp admin từ chối thuộc lát cắt sau, và khi đó phải phân biệt bằng trạng thái
đơn chứ không bằng loại bút toán.

---

## R8 — Chống hoàn tiền hai lần: hai lớp, lớp nào là chính

**Decision**: ba lớp, và lớp chính là **điều kiện nằm trong chính câu lệnh `UPDATE`** chứ không
phải một phép đọc-rồi-ghi:

```sql
UPDATE "WithdrawalRequest"
   SET status = 'CANCELLED', "processedAt" = now()
 WHERE id = $1 AND "publisherUserId" = $2 AND status = 'PENDING'
RETURNING id, amount;
```

- **Lớp 1 (chính)** — câu lệnh trên. Không khớp dòng nào ⇒ hoặc đơn không tồn tại, hoặc của người
  khác, hoặc không còn `PENDING` ⇒ câu trả lời nghiệp vụ. Bút toán hoàn tiền **chỉ được ghi khi
  câu lệnh này trả về một dòng**.
- **Lớp 2** — khoá `Profile` giữ thứ tự khoá toàn cục (R2) và bảo vệ phép cộng số dư.
- **Lớp 3** — `UNIQUE (withdrawalRequestId, type) WHERE "withdrawalRequestId" IS NOT NULL`, lưới
  an toàn cuối.

**Vì sao lớp 1 là đủ, không phụ thuộc vào việc nhớ khoá**: Postgres chạy mặc định ở
`READ COMMITTED`. Hai lệnh huỷ song song — lệnh thứ hai **chặn ở khoá dòng** mà `UPDATE` của lệnh
thứ nhất đang giữ, rồi sau khi lệnh đầu commit nó **đánh giá lại mệnh đề `WHERE`**, thấy
`status = 'CANCELLED'`, khớp **0 dòng**. Không có cửa sổ nào giữa "đọc thấy PENDING" và "ghi
CANCELLED" để chen vào, vì không có phép đọc riêng nào cả.

Đây đúng khuôn mẫu đã có trong repo: `wallet.repo.ts:tryDebitSystemAccount` và
`order.repo.ts:debitBalance` đều đặt điều kiện vào trong câu lệnh thay vì kiểm trước rồi ghi sau.

**Rationale**: SC-009 cấm mọi tình huống nghiệp vụ rơi thành lỗi hệ thống. Vi phạm unique index
nổi lên là lỗi ràng buộc → 500. Nên index **không được** là cơ chế chính; nó là lưới an toàn cho
trường hợp lập trình sai.

**Alternatives considered**: `SELECT ... FOR UPDATE` rồi kiểm `status` trong mã nguồn rồi mới
`UPDATE`. Chạy đúng, nhưng tính đúng đắn phụ thuộc vào việc người viết **nhớ** đặt `FOR UPDATE` —
bỏ quên hai chữ đó là lỗi 500 trên đường tiền, và không có gì ở tầng kiểu hay tầng dữ liệu nhắc.
Câu `UPDATE` có điều kiện không cho phép viết sai theo kiểu đó.

Hình dạng index sao chép nguyên `WalletTransaction_order_type_key` — comment của nó ghi rõ nguyên
tắc: *"Một đơn sinh nhiều nhất một bút toán mỗi loại... loại khác nhau là thứ cho phép nhiều bút
toán của cùng một đơn sống cạnh nhau."* Đây chính là lý do FR-029 đòi **loại riêng**
`WITHDRAWAL_REVERSAL` thay vì dùng `WITHDRAWAL` hai chiều: dùng chung loại thì index này không
dựng được.

---

## R9 — Trừ số dư: điều kiện nằm trong câu lệnh

**Decision**: `UPDATE "Profile" SET balance = balance - $amount WHERE "userId" = $id AND "deletedAt" IS NULL
AND balance >= $amount RETURNING balance`. Không khớp dòng nào ⇒ không đủ tiền ⇒ **422**.

**Rationale**: sao chép `wallet.repo.ts:tryDebitSystemAccount`, mang comment giải thích chính xác
lý do: *"Để CHECK của database bắt thì nó thành lỗi ràng buộc và trả 500."* FR-008 + SC-009 đòi
đúng điều này. Trả về số dư **từ chính câu lệnh đã đổi nó**, không `SELECT` lại — đọc lại là mở
một cửa sổ tranh chấp và sẽ ghi sai `balanceAfter` vào sổ cái.

Đường cộng trả lúc huỷ dùng `creditUserBalance` **đã có sẵn** trong `wallet.repo.ts:111` — không
cần viết mới.

---

## R10 — Đối soát dòng tiền: hai túi, không phải một số hạng

**Decision**:

```
tiền mặt vào + tiền tự phát hành − đã chi thật
    = nợ với người dùng + ví sàn + đang chờ chi

  đã chi thật  = SUM(amount) các đơn ở trạng thái PAID
  đang chờ chi = SUM(amount) các đơn ở trạng thái PENDING hoặc APPROVED
```

**Rationale**: trừ ví ngay lúc tạo đơn (FR-005) làm `nợ với người dùng` giảm, trong khi công ty
**vẫn đang giữ nguyên số tiền mặt đó** cho tới lúc chuyển khoản thật. Coi lúc tạo đơn là lúc tiền
rời hệ thống sẽ làm sổ sách báo thiếu đúng bằng tổng các đơn chưa chi — một đơn nằm chờ một tuần
là sổ sai suốt một tuần.

Kiểm cân ở cả ba bước chuyển:

| Bước | Vế trái | Vế phải |
|---|---|---|
| Tạo đơn | không đổi | `nợ người dùng` −X, `đang chờ chi` +X → không đổi |
| Huỷ đơn | không đổi | `đang chờ chi` −X, `nợ người dùng` +X → không đổi |
| Chi tiền | `đã chi thật` +X → giảm X | `đang chờ chi` −X → giảm X |

Trên production hiện tại cả hai túi đều bằng 0, nên đẳng thức quy về đúng dạng cũ của spec 011 và
phép đối soát đang chạy vẫn đúng.

**Alternatives considered**: `− (WITHDRAWAL − WITHDRAWAL_REVERSAL)` — bản một-số-hạng, **SAI**, lý
do ở trên. Ghi lại ở đây vì nó từng được nêu trong lúc thảo luận và trông rất hợp lý.

---

## R11 — Cách verify, khi không được commit test

**Decision** (chủ repo quyết 2026-11-27): **viết và chạy unit test đầy đủ**, để ở
`src/routes/withdrawal/test/`, và **chặn khỏi git** bằng một dòng `.gitignore`. Song song vẫn verify
theo mẫu spec 011: build `dist`, chạy `node dist/main.js`, gọi HTTP thật, kiểm database trực tiếp.

**Rationale**: commit `5b69ebd` gỡ 2 file test của module order vì chúng chạm `config.ts` qua
service mà chúng import, và `config.ts` gọi `process.exit(1)` khi env thiếu → giết CI trước khi
image được build. Nhưng nguyên nhân là **CI không có `.env`**, không phải bản thân test sai: ở máy
local `.env` đầy đủ nên test chạy bình thường. Commit đó ghi rõ "They stay on disk for local work".
Giữ test ngoài git là giữ nguyên lợi ích mà không chạm vào nguyên nhân gãy.

**Phân công giữa hai cách kiểm** — test đơn vị **không** thay được verify trên `dist`:

| Kiểm bằng unit test | Phải kiểm bằng `dist` + HTTP + SQL |
|---|---|
| Hàm thuần: so `WithdrawalClaim`, tính mốc 24 giờ, parse mức tối thiểu | Hành vi transaction (rollback khi lỗi giữa chừng) |
| Nhánh lỗi của service với repo giả | Ràng buộc database thật sự từ chối |
| Hình dạng DTO | Khoá dòng và các ca chạy song song (ca 20-23) |
| | Validate DTO (chỉ `dist` mới emit decorator metadata) |

**Alternatives considered**: `vi.mock` config để test chạy được cả trên CI — thêm một lớp giả vào
mọi test file, dễ vỡ khi config đổi. Sửa `config.ts` để không `process.exit` khi chạy test — đụng
vào đường khởi động production để phục vụ test, đổi chỗ rủi ro chứ không giảm.

**Bắt buộc chạy trên `dist`, không phải `start:dev`**: `tsx` không emit decorator metadata nên DTO
**không được validate** — một bài test bằng `start:dev` sẽ cho qua đúng những input mà spec này
đòi phải chặn.

**Dựng dữ liệu**: DB local sau khi reset chỉ còn 1 profile admin, 0 sản phẩm. Dùng `ADMIN_GRANT`
qua `POST /admin/wallet-transactions/grant` để tạo số dư cho nhà phát hành — rẻ hơn nhiều so với
dựng publisher + sản phẩm + offer + người mua, và FR-004 nói rõ nguồn tiền không quan trọng. Ví
sàn phải được bơm trước bằng `POST /admin/system-account/issue-credit`, vì `grantToUser` là một
lần **chuyển khoản** và sẽ trả 422 nếu ví sàn rỗng.

---

## R12 — Trạng thái khai đủ 5 giá trị ngay từ migration đầu

**Decision**: enum `WithdrawalRequestStatus` khai đủ `PENDING`, `APPROVED`, `REJECTED`, `PAID`,
`CANCELLED` ngay file migration đầu tiên, dù lát cắt này chỉ sinh `PENDING` và `CANCELLED`.

**Rationale**: FR-022. Thêm giá trị enum sau này lại vướng đúng R1 (phải tách migration riêng, vì
lát cắt duyệt đơn sẽ dùng ngay giá trị vừa thêm). Khai sẵn là một dòng SQL bây giờ, đổi lấy việc
không phải tách migration lần nữa.

Đây **không** vi phạm Nguyên tắc VI: không phải trừu tượng hoá cho nhu cầu giả định — lát cắt
duyệt đơn là việc đã chốt làm, chỉ chưa làm.

---

## R13 — Tên route và vị trí module

**Decision**: `POST /withdrawals`, `GET /withdrawals/me`, `GET /withdrawals/:withdrawalId`,
`POST /withdrawals/:withdrawalId/cancel`. Module ở `src/routes/withdrawal/`.

**Rationale**: `GET /me` phải khai **trước** `GET /:withdrawalId`, vì Nest khớp theo thứ tự khai
báo và nếu ngược lại thì `"me"` bị đọc thành id rồi fail kiểm UUID — comment ở
`order.controller.ts:41` đã ghi lại đúng bẫy này.

Huỷ đơn dùng `POST .../cancel` chứ không `DELETE`: đơn không bị xoá, nó chuyển trạng thái và để
lại bút toán. `DELETE` sẽ nói sai bản chất.

Module phụ thuộc `PublisherModule` (đã export `PublisherAccessPolicy`), `WalletCoreModule` và
`SystemSettingCoreModule` — dùng bản `*Core` không mang controller, đúng như `OrderModule` làm,
để không vô tình phơi route admin ra cổng cron.
