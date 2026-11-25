# Data Model: Sổ cái ví và tài khoản tiền của sàn (phase 3)

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Quyết định**: [research.md](./research.md)

Hai bảng mới, ba enum mới. **Không bảng nào đang có bị đổi cấu trúc** — `Profile` chỉ nhận thêm một
ràng buộc, không thêm cột. Khi review migration: thấy `ALTER TABLE` thêm hoặc xoá cột trên bảng cũ
là sai thiết kế.

## 1. Tiền nằm ở đâu

Sau phase này, số dư nằm ở **đúng hai cột** trong toàn hệ thống:

```text
Profile.balance        → ví từng người (khách và nhà phát hành dùng chung cột này)
SystemAccount.balance  → tiền của sàn
ngân hàng              → NGOÀI database, không có cột nào
```

`WalletTransaction` **không giữ tiền**. Nó giải thích hai cột trên. Số dư vẫn là nguồn đúng về
"còn bao nhiêu", sổ cái là nguồn đúng về "vì sao".

## 2. `SystemAccount`

```text
SystemAccount
  type       SystemAccountType PK
  balance    BIGINT, required, >= 0
  updatedAt  TIMESTAMPTZ, nullable
```

```text
SystemAccountType = PLATFORM_REVENUE
```

Một dòng duy nhất ở phase này. Enum có đúng một giá trị là **cố ý** (Nguyên tắc VI): thêm giá trị
sau này không đụng bản ghi đã có, còn thêm sẵn giá trị chưa dùng là trừu tượng hoá sớm.

Khoá chính là chính cột `type`, không có `id` riêng — bảng này là một tập hợp cố định các tài
khoản có tên, không phải một danh sách bản ghi sinh ra theo thời gian.

## 3. `WalletTransaction`

```text
WalletTransaction
  id                  UUID PK
  userId              UUID FK User, NULLABLE
  systemAccount       SystemAccountType FK SystemAccount, NULLABLE
  type                WalletTransactionType, required
  direction           WalletDirection, required
  amount              BIGINT, required, > 0
  balanceAfter        BIGINT, required, >= 0
  orderId             UUID FK Order, nullable
  topUpTransactionId  UUID FK TopUpTransaction, nullable
  transferId          UUID, nullable
  note                TEXT, nullable
  createdById         UUID FK User, nullable
  createdAt           TIMESTAMPTZ, required
```

```text
WalletTransactionType = TOPUP | PURCHASE | EARNING | COMMISSION | ADMIN_GRANT | ISSUED_CREDIT
WalletDirection       = CREDIT | DEBIT
```

Ghi một lần, không sửa, không xoá: đây là bản ghi lịch sử chứ không phải trạng thái. Không có
`updatedAt`, không có xoá mềm.

### 3.1 Bảy tổ hợp hợp lệ, không hơn

| `type` | `direction` | tài khoản | nguồn | `note` + `createdById` | `transferId` |
|---|---|---|---|---|---|
| `TOPUP` | CREDIT | `userId` | `topUpTransactionId` | — | — |
| `PURCHASE` | DEBIT | `userId` | `orderId` | — | — |
| `EARNING` | CREDIT | `userId` (publisher) | `orderId` | — | — |
| `COMMISSION` | CREDIT | `systemAccount` | `orderId` | — | — |
| `ADMIN_GRANT` | **DEBIT** | `systemAccount` | — | bắt buộc | bắt buộc |
| `ADMIN_GRANT` | **CREDIT** | `userId` | — | bắt buộc | bắt buộc |
| `ISSUED_CREDIT` | CREDIT | `systemAccount` | — | bắt buộc | — |

Phase 4 thêm `WITHDRAWAL` (DEBIT, `userId`). Spec bảo hành thêm các loại giữ/giải phóng. Thêm giá
trị vào enum không đụng bản ghi đã có, nên FR-017 được thoả mà không cần thiết kế gì thêm.

### 3.2 `amount` luôn dương

Dấu nằm ở `direction`, không nằm ở số tiền (FR-004). Một bút toán giảm là `direction = DEBIT` với
`amount` dương. Nếu cho phép số âm thì `amount = -5000` do bug và `amount = -5000` do cố ý trông
giống hệt nhau, không ràng buộc nào phân biệt được; tách dấu ra chỗ khác thì `CHECK (amount > 0)`
bắt được cả một lớp lỗi.

Hệ quả: mọi câu tính tổng đều có đúng một hình dạng, lặp lại khắp tài liệu này:

```sql
SUM(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END)
```

### 3.3 `direction` luôn nhìn từ tài khoản ghi trên chính dòng đó

`CREDIT` = số dư của **tài khoản đó** tăng; `DEBIT` = giảm. Đây là lý do một lần `ADMIN_GRANT` có
hai dòng ngược chiều nhau: mỗi dòng viết từ góc nhìn của tài khoản riêng nó, cùng một sự kiện.

Quy ước này trùng khít với kế toán kép vì mọi tài khoản trong bảng đều là **nợ phải trả** (ví người
dùng) hoặc **vốn** (tài khoản của sàn) — cả hai loại đều tăng khi ghi Có. **Nếu sau này có ai đưa
tài khoản ngân hàng vào bảng này thì quy ước gãy**, vì tài sản tăng khi ghi Nợ. Bảng này chỉ chứa
ví của người và tài khoản của sàn; ngân hàng đối chiếu bằng truy vấn (e), không bằng một dòng ví.

## 4. Hợp đồng SQL

```sql
CREATE TYPE "WalletTransactionType" AS ENUM (
    'TOPUP', 'PURCHASE', 'EARNING', 'COMMISSION', 'ADMIN_GRANT', 'ISSUED_CREDIT'
);
CREATE TYPE "WalletDirection"   AS ENUM ('CREDIT', 'DEBIT');
CREATE TYPE "SystemAccountType" AS ENUM ('PLATFORM_REVENUE');

CREATE TABLE "SystemAccount" (
    type        "SystemAccountType" PRIMARY KEY,
    balance     BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ,
    CONSTRAINT "SystemAccount_balance_check" CHECK (balance >= 0)
);

INSERT INTO "SystemAccount" (type, balance) VALUES ('PLATFORM_REVENUE', 0);

CREATE TABLE "WalletTransaction" (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId"             UUID REFERENCES "User" (id) ON DELETE NO ACTION,
    "systemAccount"      "SystemAccountType"
                           REFERENCES "SystemAccount" (type) ON DELETE NO ACTION,
    type                 "WalletTransactionType" NOT NULL,
    direction            "WalletDirection" NOT NULL,
    amount               BIGINT NOT NULL,
    -- Ràng buộc không-âm cho cột này nằm ở cuối file, sau khi dựng xong lịch sử.
    "balanceAfter"       BIGINT NOT NULL,
    "orderId"            UUID REFERENCES "Order" (id) ON DELETE NO ACTION,
    "topUpTransactionId" UUID REFERENCES "TopUpTransaction" (id) ON DELETE NO ACTION,
    "transferId"         UUID,
    note                 TEXT,
    "createdById"        UUID REFERENCES "User" (id) ON DELETE NO ACTION,
    "createdAt"          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "WalletTransaction_amount_check" CHECK (amount > 0),

    -- Đúng một phía: ví người dùng HOẶC tài khoản hệ thống. Khoá ngoại vẫn kiểm mọi
    -- giá trị không rỗng; CHECK này làm bất biến trở nên toàn phần.
    CONSTRAINT "WalletTransaction_account_check" CHECK (
        (("userId" IS NOT NULL)::int + ("systemAccount" IS NOT NULL)::int) = 1
    ),

    -- Loại nào ở phía nào, chiều nào. Ràng buộc gánh phần nặng nhất của cả thiết kế:
    -- hai dòng cuối khoá chân trừ của ADMIN_GRANT vào tài khoản hệ thống, nên
    -- "quản trị viên chỉ cho đi được tiền sàn đang có" là điều chứng minh được,
    -- không phải điều tin là đúng.
    CONSTRAINT "WalletTransaction_accountKind_check" CHECK (
           (type IN ('TOPUP','EARNING')
                AND direction = 'CREDIT' AND "userId" IS NOT NULL)
        OR (type = 'PURCHASE'
                AND direction = 'DEBIT'  AND "userId" IS NOT NULL)
        OR (type IN ('COMMISSION','ISSUED_CREDIT')
                AND direction = 'CREDIT' AND "systemAccount" IS NOT NULL)
        OR (type = 'ADMIN_GRANT'
                AND direction = 'DEBIT'  AND "systemAccount" IS NOT NULL)
        OR (type = 'ADMIN_GRANT'
                AND direction = 'CREDIT' AND "userId" IS NOT NULL)
    ),

    CONSTRAINT "WalletTransaction_source_check" CHECK (
           (type = 'TOPUP'
                AND "topUpTransactionId" IS NOT NULL AND "orderId" IS NULL)
        OR (type IN ('PURCHASE','EARNING','COMMISSION')
                AND "orderId" IS NOT NULL AND "topUpTransactionId" IS NULL)
        OR (type IN ('ADMIN_GRANT','ISSUED_CREDIT')
                AND "orderId" IS NULL AND "topUpTransactionId" IS NULL)
    ),

    -- Tiền do người điều hành tạo ra hoặc chuyển đi phải nói ai làm và vì sao.
    CONSTRAINT "WalletTransaction_actor_check" CHECK (
        type NOT IN ('ADMIN_GRANT','ISSUED_CREDIT')
        OR ("createdById" IS NOT NULL
            AND note IS NOT NULL AND length(trim(note)) > 0)
    ),

    CONSTRAINT "WalletTransaction_transfer_check" CHECK (
           (type =  'ADMIN_GRANT' AND "transferId" IS NOT NULL)
        OR (type <> 'ADMIN_GRANT' AND "transferId" IS NULL)
    )
);
```

### Index

```sql
-- Một đơn sinh nhiều nhất một bút toán mỗi loại. Một lần chạy lại chạm tới đây
-- thay vì nhân đôi số tiền; các loại khác nhau là thứ cho phép ba bút toán của
-- cùng một đơn sống cạnh nhau.
CREATE UNIQUE INDEX "WalletTransaction_order_type_key"
ON "WalletTransaction" ("orderId", type) WHERE "orderId" IS NOT NULL;

CREATE UNIQUE INDEX "WalletTransaction_topUp_key"
ON "WalletTransaction" ("topUpTransactionId") WHERE "topUpTransactionId" IS NOT NULL;

-- Một lần chuyển khoản có đúng hai chân, mỗi chiều một chân.
CREATE UNIQUE INDEX "WalletTransaction_transfer_leg_key"
ON "WalletTransaction" ("transferId", direction) WHERE "transferId" IS NOT NULL;

CREATE INDEX "WalletTransaction_userId_createdAt_idx"
ON "WalletTransaction" ("userId", "createdAt" DESC) WHERE "userId" IS NOT NULL;

CREATE INDEX "WalletTransaction_systemAccount_createdAt_idx"
ON "WalletTransaction" ("systemAccount", "createdAt" DESC)
WHERE "systemAccount" IS NOT NULL;
```

### Hai ràng buộc không-âm, thêm ở CUỐI file migration

```sql
ALTER TABLE "WalletTransaction"
    ADD CONSTRAINT "WalletTransaction_balanceAfter_check" CHECK ("balanceAfter" >= 0);

ALTER TABLE "Profile"
    ADD CONSTRAINT "Profile_balance_check" CHECK (balance >= 0);
```

Lý do đặt cuối: các bước backfill chèn `balanceAfter` bằng **giá trị tạm 0** (cột là `NOT NULL`
ngay từ `CREATE TABLE`, mà bước điền số dư luỹ kế chạy sau cùng). Thêm ràng buộc ở cuối nghĩa là
giá trị tạm hợp lệ cho tới lúc đó, và cả hai ràng buộc được kiểm đúng một lần trên dữ liệu đã xong.

`SystemAccount_balance_check` thì khai ngay từ `CREATE TABLE` được, vì bảng đó khởi tạo bằng 0 và
chỉ tăng trong lúc backfill.

## 5. Bất biến

Đặt được ở tầng dữ liệu (xem mục 4):

- `amount > 0` với mọi bút toán.
- Mỗi bản ghi thuộc đúng một tài khoản.
- `direction` và phía tài khoản khớp `type` theo đúng bảng 3.1.
- Mỗi loại mang đúng nguồn của nó.
- `ADMIN_GRANT` và `ISSUED_CREDIT` luôn có người thực hiện và lý do.
- Mọi số dư không âm.

**Không** đặt được ở tầng dữ liệu vì trải trên nhiều dòng hoặc nhiều bảng — đây là lý do mục 7 tồn
tại:

- Mỗi ví: `Σ CREDIT − Σ DEBIT = Profile.balance`
- Tài khoản của sàn: `Σ CREDIT − Σ DEBIT = SystemAccount.balance`
- Mỗi đơn: ba bút toán khớp ba cột trên chính `Order`
- Mỗi `transferId`: đúng hai chân, số tiền bằng nhau

## 6. Dọn dữ liệu và dựng lại lịch sử

### 6.1 Khoản quản trị viên đã cấp thẳng vào dữ liệu

**Không dọn, mà ghi lại** (đảo quyết định 2026-11-25). Hai ví mang 15.994.000 ₫ do quản trị viên
đặt thẳng vào dữ liệu là **người dùng thật** đang giữ 6 quyền truy cập còn hiệu lực, một trong hai
đã nạp tiền thật — nên xoá đơn và đưa số dư về 0 là phá huỷ trạng thái thật của họ.

Thay vào đó, ghi đúng việc đã xảy ra:

```text
ISSUED_CREDIT  +15.994.000  →  ví sàn        (có note + người thực hiện bắt buộc)
ADMIN_GRANT    −10.000.000  ví sàn → ví A    (2 chân, cùng transferId)
ADMIN_GRANT     −5.994.000  ví sàn → ví B    (2 chân, cùng transferId)
```

Ví sàn cộng rồi trừ bằng nhau nên về lại tổng hoa hồng. Mọi ví khớp tuyệt đối.

**Bước này KHÔNG nằm trong file migration của repo.** Nó hardcode UUID của hai người dùng thật và
của tài khoản quản trị viên production, nên nằm ở `prod-apply.local.sql` (đã `.gitignore`), chạy
một lần, bằng tay, **trong cùng transaction** với phần migration — xem `docs/deployment-runbook.md`
mục B9.1 và mục Complexity Tracking của [plan.md](./plan.md).

**Vì sao không tách ra được**: bước này cần bảng sổ cái đã tồn tại, nhưng phải chạy **trước** hai
chốt dừng ở 6.2. Chạy trước migration thì chưa có bảng, chạy sau thì migration đã dừng. Không có
khe nào để chen vào giữa.

**Ba thứ giữ cho nó không thành cửa sau:** danh sách ví **cố định**, không phải truy vấn dẫn xuất;
phần chênh tính **từ chính sổ cái** nên chạy lại là bỏ qua; **bỏ qua kèm NOTICE** nếu không có tài
khoản quản trị viên đó, nên database rỗng hay máy cá nhân không bị bịa bút toán.

**Đã kiểm trên chính dữ liệu production** ngày 2026-11-25, chạy trong transaction rồi `ROLLBACK`
hai lần: bốn phép đối soát ra 0 dòng, đẳng thức dòng tiền đúng.

### 6.2 Backfill, trong cùng file migration

**Bước 1 — nạp tiền.** Một bút toán `TOPUP` cho mỗi lần nạp đã ghi có, dùng `creditedAt`.

**Bước 2 — mua hàng.** Một bút toán `PURCHASE` cho mỗi đơn có `totalAmount > 0`, dùng `paidAt`.

**Bước 3 — bán hàng.** Một bút toán `EARNING` cho mỗi đơn có `publisherAmount > 0`, dùng `paidAt`.
*Trên production hiện tại bước này sinh 0 dòng*, vì phase 2 đã ghi mọi đơn cũ về phía sàn.

**Bước 4 — hoa hồng.** Một bút toán `COMMISSION` cho mỗi đơn có `commissionAmount > 0`, dùng
`paidAt`, rồi `UPDATE SystemAccount SET balance = Σ commissionAmount`.

Ghi **từng đơn một**, không phải một khoản gộp (FR-022): truy nguyên được tới từng đơn, và tài
khoản của sàn không có bản ghi nào thiếu nguồn gốc.

Cả bốn bước chèn `balanceAfter` bằng **0** và dùng `ON CONFLICT DO NOTHING` trên index duy nhất ở
mục 4 — đó là chốt chặn chạy trùng (FR-023).

**Bước 5 — CHỐT DỪNG 1.** Ví nào lịch sử cộng ra nhiều hơn số dư thật → `RAISE EXCEPTION` kèm danh
sách ví. Không còn cơ chế bù trừ chiều âm, và quản trị viên trừ tiền nằm ngoài phạm vi.

**Bước 6 — CHỐT DỪNG 2.** Tài khoản nào còn lệch bất kỳ → `RAISE EXCEPTION` kèm danh sách.

Hai chốt này là **khác biệt lớn nhất so với bản thiết kế ngày 2026-11-24**. Khi còn
`OPENING_BALANCE`, mọi chênh lệch đều được hấp thụ; nay mọi tài khoản phải khớp tuyệt đối. Nếu bước
0 làm chưa sạch thì phải biết **ngay tại migration**, không phải sau khi bảng đã có dữ liệu
production.

**Bước 7 — điền số dư sau.** Phát lại toàn bộ lịch sử theo thứ tự, điền `balanceAfter` bằng tổng
luỹ kế:

```sql
WITH ordered AS (
    SELECT id,
           SUM(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END)
             OVER (PARTITION BY COALESCE("userId"::text, "systemAccount"::text)
                   ORDER BY "createdAt",
                            CASE type
                              WHEN 'ISSUED_CREDIT' THEN 0 WHEN 'TOPUP'       THEN 1
                              WHEN 'COMMISSION'    THEN 2 WHEN 'EARNING'     THEN 3
                              WHEN 'ADMIN_GRANT'   THEN 4 ELSE 5 END,
                            id
                   ROWS UNBOUNDED PRECEDING) AS running
    FROM "WalletTransaction"
)
UPDATE "WalletTransaction" w
SET "balanceAfter" = o.running
FROM ordered o WHERE o.id = w.id;
```

Phân hoạch theo `COALESCE("userId"::text, "systemAccount"::text)` vì nay có hai loại tài khoản
trong cùng bảng. Thứ tự phụ (loại, rồi `id`) là thứ làm kết quả **lặp lại được** khi hai mốc thời gian trùng nhau
(SC-007). Thứ hạng xếp **mọi khoản ghi có trước mọi khoản ghi nợ**: `COMMISSION` là khoản ghi có
duy nhất nuôi tài khoản của sàn, để nó sau chân nợ của `ADMIN_GRANT` là mời số dư ví sàn đi qua
vùng âm khi hai dòng trùng mốc.

**Bước 8 — hai ràng buộc không-âm** (mục 4).

## 7. Năm phép đối soát

Công cụ vận hành, đưa vào `docs/deployment-runbook.md`. Bốn phép đầu phải trả về **0 dòng**.

```sql
-- (a) Ví người dùng khớp lịch sử của nó.
SELECT pr."userId", pr.balance,
       COALESCE(SUM(CASE w.direction WHEN 'CREDIT' THEN w.amount
                                     ELSE -w.amount END), 0) AS tu_so_cai
FROM "Profile" pr
LEFT JOIN "WalletTransaction" w ON w."userId" = pr."userId"
WHERE pr."deletedAt" IS NULL
GROUP BY pr."userId", pr.balance
HAVING pr.balance <> COALESCE(SUM(CASE w.direction WHEN 'CREDIT' THEN w.amount
                                                   ELSE -w.amount END), 0);

-- (b) Tài khoản của sàn khớp lịch sử của nó.
--     KHÔNG có bộ lọc deletedAt ở đâu cả — đó chính là lý do tiền của sàn nằm ở
--     bảng riêng thay vì ở một tài khoản người dùng dành riêng (research.md R4).
SELECT sa.type, sa.balance,
       COALESCE(SUM(CASE w.direction WHEN 'CREDIT' THEN w.amount
                                     ELSE -w.amount END), 0) AS tu_so_cai
FROM "SystemAccount" sa
LEFT JOIN "WalletTransaction" w ON w."systemAccount" = sa.type
GROUP BY sa.type, sa.balance
HAVING sa.balance <> COALESCE(SUM(CASE w.direction WHEN 'CREDIT' THEN w.amount
                                                   ELSE -w.amount END), 0);

-- (c) Mỗi đơn: ba bút toán khớp CHÍNH ba cột trên Order.
--     So với cột trên đơn, không so ba bút toán với nhau: ba dòng khớp nhau mà cùng
--     lệch khỏi đơn thì vẫn là trôi dữ liệu. Đẳng thức
--     PURCHASE = EARNING + COMMISSION suy ra từ splitAmount, không cần kiểm riêng.
SELECT o.id, o."totalAmount", o."publisherAmount", o."commissionAmount"
FROM "Order" o
JOIN "WalletTransaction" w ON w."orderId" = o.id
GROUP BY o.id, o."totalAmount", o."publisherAmount", o."commissionAmount"
HAVING SUM(CASE WHEN w.type = 'PURCHASE'   THEN w.amount ELSE 0 END)
         <> o."totalAmount"
    OR SUM(CASE WHEN w.type = 'EARNING'    THEN w.amount ELSE 0 END)
         <> o."publisherAmount"
    OR SUM(CASE WHEN w.type = 'COMMISSION' THEN w.amount ELSE 0 END)
         <> o."commissionAmount";

-- (d) Mỗi lần chuyển khoản có đúng hai chân và hai chân bằng nhau.
SELECT "transferId"
FROM "WalletTransaction"
WHERE "transferId" IS NOT NULL
GROUP BY "transferId"
HAVING SUM(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END) <> 0
    OR count(*) <> 2;

-- (e) BÁO CÁO DÒNG TIỀN — không phải phép kiểm 0 dòng, mà là bảng theo dõi.
SELECT
  (SELECT COALESCE(SUM("receivedAmount"), 0) FROM "TopUpTransaction"
    WHERE "creditedAt" IS NOT NULL)                       AS tien_mat_vao,
  (SELECT COALESCE(SUM(amount), 0) FROM "WalletTransaction"
    WHERE type = 'COMMISSION')                            AS hoa_hong_thu_duoc,
  (SELECT COALESCE(SUM(amount), 0) FROM "WalletTransaction"
    WHERE type = 'ISSUED_CREDIT')                         AS tien_tu_phat_hanh,
  (SELECT COALESCE(SUM(balance), 0) FROM "Profile"
    WHERE "deletedAt" IS NULL)                            AS no_voi_nguoi_dung,
  (SELECT balance FROM "SystemAccount"
    WHERE type = 'PLATFORM_REVENUE')                      AS so_du_vi_san;

-- Đẳng thức phải đúng:
--   tien_mat_vao + tien_tu_phat_hanh = no_voi_nguoi_dung + so_du_vi_san
--
-- CHỈ đúng khi chưa có đường rút tiền. Phase 4 thêm một số hạng (− tien_da_chi_rut)
-- vào vế trái. Đừng coi nó là bất biến vĩnh viễn.
```

Truy vấn (a) và (b) **sẽ** hiện ra tài khoản nào bị đổi số dư bằng lệnh trực tiếp sau khi sổ cái đã
có. Đó là tính năng, không phải lỗi (FR-026, FR-027).

Dòng `tien_tu_phat_hanh` ở truy vấn (e) là câu trả lời cho vấn đề đã sinh ra cả spec này: khoản
chênh giữa dòng tiền nạp và dòng tiền rút. Nó không biến mất — nó có tên, có mức, và có người chịu
trách nhiệm.
