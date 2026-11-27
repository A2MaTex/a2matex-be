# Data Model: Tạo đơn rút tiền cho nhà phát hành

**Phase 1** · 2026-11-27 · [plan.md](./plan.md) · [research.md](./research.md)

---

## 1. Bảng mới: `WithdrawalRequest`

| Cột | Kiểu | Ràng buộc | Ghi chú |
|---|---|---|---|
| `id` | `UUID` | PK, `gen_random_uuid()` | |
| `publisherUserId` | `UUID` | NOT NULL, FK → `User(id)` | Chủ đơn. Trỏ `User` chứ không `PublisherAccount`, vì ví nằm trên `Profile.userId` |
| `amount` | `BIGINT` | NOT NULL, `CHECK (amount > 0)` | Số tiền rút, đơn vị đồng |
| `status` | `WithdrawalRequestStatus` | NOT NULL, mặc định `PENDING` | |
| `bankAccountNumber` | `VARCHAR(50)` | NOT NULL | Bản chụp (FR-019) |
| `bankName` | `VARCHAR(255)` | NOT NULL | Bản chụp |
| `bankAccountHolder` | `VARCHAR(255)` | NOT NULL | Bản chụp |
| `idempotencyKey` | `UUID` | NOT NULL | Chống lặp (FR-033) |
| `bankTransferRef` | `TEXT` | NULL | Mã giao dịch admin nhập tay (FR-027). Lát cắt này chỉ khai chỗ |
| `rejectionReason` | `TEXT` | NULL | Lát cắt sau |
| `createdAt` | `TIMESTAMPTZ` | NOT NULL, `now()` | **Mốc neo của quy tắc 24 giờ** (FR-013) |
| `processedAt` | `TIMESTAMPTZ` | NULL | Lúc rời khỏi `PENDING` |
| `processedById` | `UUID` | NULL, FK → `User(id)` | Admin xử lý. NULL khi publisher tự huỷ |

### Index

```sql
-- Chống lặp, phạm vi từng người: hai publisher dùng trùng khoá là chuyện bình thường.
CREATE UNIQUE INDEX "WithdrawalRequest_publisher_idempotency_key"
ON "WithdrawalRequest" ("publisherUserId", "idempotencyKey");

-- Phục vụ cả danh sách của publisher (FR mục US2) lẫn phép kiểm 24 giờ (R3).
CREATE INDEX "WithdrawalRequest_publisher_createdAt_idx"
ON "WithdrawalRequest" ("publisherUserId", "createdAt" DESC);
```

### Ràng buộc nhất quán trạng thái

```sql
-- Đơn đã rời PENDING phải nói rõ rời lúc nào. Không ép processedById, vì publisher
-- tự huỷ thì không có admin nào (FR-031).
CONSTRAINT "WithdrawalRequest_processed_check" CHECK (
       (status = 'PENDING'  AND "processedAt" IS NULL)
    OR (status <> 'PENDING' AND "processedAt" IS NOT NULL)
)

-- Mã giao dịch ngân hàng chỉ có nghĩa khi đã chi thật.
CONSTRAINT "WithdrawalRequest_transferRef_check" CHECK (
    "bankTransferRef" IS NULL OR status = 'PAID'
)

-- Lý do từ chối chỉ có nghĩa với đơn bị từ chối.
CONSTRAINT "WithdrawalRequest_rejection_check" CHECK (
    "rejectionReason" IS NULL OR status = 'REJECTED'
)
```

> **Không** khai `deletedAt`. Đơn rút tiền là chứng từ tiền, giống `WalletTransaction` — ghi rồi
> không xoá. Trạng thái `CANCELLED` là cách huỷ, không phải xoá mềm.

---

## 2. Enum mới

```sql
CREATE TYPE "WithdrawalRequestStatus" AS ENUM
  ('PENDING', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED');
```

Khai đủ 5 ngay từ đầu (FR-022, R12) dù lát cắt này chỉ sinh `PENDING` và `CANCELLED`.

### Máy trạng thái

```
                   ┌──────────► CANCELLED   (publisher tự huỷ — LÁT CẮT NÀY)
                   │
    ──► PENDING ───┼──────────► REJECTED    (admin từ chối — lát cắt sau)
                   │
                   └──► APPROVED ──► PAID   (admin duyệt rồi chuyển khoản — lát cắt sau)
```

| Chuyển | Ai | Tiền | Bút toán | Lát cắt này |
|---|---|---|---|---|
| → `PENDING` | publisher | trừ ví | `WITHDRAWAL` | ✅ |
| `PENDING` → `CANCELLED` | publisher | cộng trả | `WITHDRAWAL_REVERSAL` | ✅ |
| `PENDING` → `REJECTED` | admin | cộng trả | `WITHDRAWAL_REVERSAL` | ❌ sau |
| `PENDING` → `APPROVED` | admin | không đổi | không có | ❌ sau |
| `APPROVED` → `PAID` | admin | không đổi | không có | ❌ sau |

**`APPROVED` → `PAID` không sinh bút toán nào** — tiền đã rời ví từ lúc tạo đơn. Bước đó chỉ
chuyển số tiền từ túi "đang chờ chi" sang túi "đã chi thật" trong phép đối soát (R10), và hai túi
đó tính từ `status` của đơn chứ không từ sổ cái.

---

## 3. Sửa `WalletTransaction` (bảng đã có)

### 3.1 Hai giá trị enum mới — **migration riêng** (R1)

```sql
ALTER TYPE "WalletTransactionType" ADD VALUE 'WITHDRAWAL';
ALTER TYPE "WalletTransactionType" ADD VALUE 'WITHDRAWAL_REVERSAL';
```

### 3.2 Cột mới + index

```sql
ALTER TABLE "WalletTransaction"
  ADD COLUMN "withdrawalRequestId" UUID
  REFERENCES "WithdrawalRequest" (id) ON DELETE NO ACTION;

-- Một đơn sinh nhiều nhất một bút toán mỗi loại. Đây là chốt chặn hoàn tiền hai lần
-- (FR-025) — LỚP PHỤ, không phải cơ chế chính (R8).
CREATE UNIQUE INDEX "WalletTransaction_withdrawal_type_key"
ON "WalletTransaction" ("withdrawalRequestId", type)
WHERE "withdrawalRequestId" IS NOT NULL;

CREATE INDEX "WalletTransaction_withdrawal_idx"
ON "WalletTransaction" ("withdrawalRequestId")
WHERE "withdrawalRequestId" IS NOT NULL;
```

### 3.3 `accountKind_check` — thêm 2 nhánh (7 → 9 tổ hợp)

```sql
 OR (type = 'WITHDRAWAL'
         AND direction = 'DEBIT'  AND "userId" IS NOT NULL)
 OR (type = 'WITHDRAWAL_REVERSAL'
         AND direction = 'CREDIT' AND "userId" IS NOT NULL)
```

Bản sao ở tầng ứng dụng `WALLET_ENTRY_SHAPES` (`src/shared/constants/wallet.constant.ts`) cập
nhật từ 7 lên **9** phần tử.

### 3.4 `source_check` — viết lại **toàn bộ**, không chỉ thêm nhánh (R6 — bẫy im lặng)

```sql
ALTER TABLE "WalletTransaction" DROP CONSTRAINT "WalletTransaction_source_check";
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_source_check" CHECK (
       (type = 'TOPUP'
            AND "topUpTransactionId" IS NOT NULL
            AND "orderId" IS NULL AND "withdrawalRequestId" IS NULL)
    OR (type IN ('PURCHASE','EARNING','COMMISSION')
            AND "orderId" IS NOT NULL
            AND "topUpTransactionId" IS NULL AND "withdrawalRequestId" IS NULL)
    OR (type IN ('ADMIN_GRANT','ISSUED_CREDIT')
            AND "orderId" IS NULL AND "topUpTransactionId" IS NULL
            AND "withdrawalRequestId" IS NULL)
    OR (type IN ('WITHDRAWAL','WITHDRAWAL_REVERSAL')
            AND "withdrawalRequestId" IS NOT NULL
            AND "orderId" IS NULL AND "topUpTransactionId" IS NULL)
);
```

> Mỗi nhánh cũ **phải** thêm `"withdrawalRequestId" IS NULL`. Chỉ thêm nhánh mới thì một dòng
> `ADMIN_GRANT` vẫn mang được `withdrawalRequestId` và ràng buộc cho qua — không test nào fail,
> chỉ dữ liệu bẩn dần.

### 3.5 `actor_check` — **giữ nguyên** (R7)

Không thêm `WITHDRAWAL_REVERSAL` vào danh sách bắt buộc có `createdById` + `note`. Lát cắt này chỉ
sinh reversal do publisher tự huỷ, không có admin nào để điền; thêm vào sẽ chặn đúng đường đang làm.

---

## 4. Khoá `SystemSetting` mới

| Khoá | Schema | Giá trị khởi tạo |
|---|---|---|
| `WITHDRAWAL_MIN_AMOUNT` | `{ amount: chuỗi thập phân, kiểm trần BIGINT }` | `{"amount":"100000"}` |

Khai ở `system-setting.constant.ts` (hằng khoá) **và** `system-setting.registry.ts` (schema +
`valueSchema` cho form admin) — khoá chỉ dùng được khi có mặt ở cả hai.

**Schema phải kiểm trần `BIGINT` (R5)**: `^\d{1,19}$` trần trụi cho qua `9999999999999999999`
vượt trần → 22003 → **500**. Lỗi thật đã tìm ra ở code review spec 011.

Giá trị khởi tạo thêm vào `src/seed/seed-system-settings.ts`, chạy lại báo `already set` như các
khoá khác.

---

## 5. Thực thể Zod

```
withdrawal.model.ts
├── WithdrawalRequestStatusSchema      → entities/withdrawal-request.model.ts (dùng chung)
├── CreateWithdrawalInput              { amount, bankAccountNumber, bankName, bankAccountHolder }
├── WithdrawalOutput                   { id, amount, status, bank*, createdAt, processedAt, bankTransferRef, rejectionReason }
├── WithdrawalMutationOutput           WithdrawalOutput + { balanceAfter }   ← CHỈ cho tạo đơn và huỷ đơn
├── GetMyWithdrawalsInput              { page, limit }  — trần WITHDRAWAL_PAGE_SIZE_MAX = 100
├── GetMyWithdrawalsOutput             { items, totalItems, page, pageSize, totalPages }
└── WithdrawalIdParam                  { withdrawalId: uuid }
```

**`balanceAfter` chỉ nằm ở `WithdrawalMutationOutput`**, không nằm ở `WithdrawalOutput`. Hai route
đọc (`/me` và `/:id`) không trả số dư: số dư lúc đó không còn liên quan tới đơn, và trả kèm sẽ gợi
ý sai rằng đó là số dư tại thời điểm tạo đơn. Số dư hiện tại tra ở `GET /wallet-transactions`.

**`WITHDRAWAL_PAGE_SIZE_MAX = 100`**, bằng với `WALLET_PAGE_SIZE_MAX` và `ORDER_PAGE_SIZE_MAX`.

**Bẫy kiểu đã biết**: output dùng `zBigIntAsString()` thì type phải là `z.input<typeof X>`, **không
phải** `z.infer` — `infer` cho kiểu sau transform (string) còn service trả `bigint`.

**Phân trang**: list endpoint trả `{items: [...]}`, không phải `{data: [...]}` —
`transform.interceptor.ts` tự bọc `{data: ...}` nên trả `data` sẽ bị bọc hai lần.

---

## 6. Quy tắc nghiệp vụ gắn vào đâu

| Quy tắc | FR | Nơi thực thi |
|---|---|---|
| Chỉ publisher đang hoạt động | 001-003 | `PublisherAccessPolicy.assertActivePublisher()` — **trước** khi mở transaction |
| Chống lặp, chốt 1 | 016a, 033 | Service, trước transaction |
| Khoá `Profile` | 007, 016, 025a | Repo, SQL thô `FOR UPDATE` |
| Chống lặp, chốt 2 | 034 | Service, sau khi có khoá |
| Mốc 24 giờ | 013-015 | Service, sau khoá, `SELECT max(createdAt)` không `FOR UPDATE` |
| Mức tối thiểu | 010-012 | Service, đọc trong transaction, không cache |
| Đủ số dư | 006-008 | Điều kiện trong chính `UPDATE` |
| Không âm | 006 | `CHECK (balance >= 0)` — **lưới an toàn**, không phải cơ chế chính |
| Hoàn một lần | 025 | Khoá `Profile` + đọc lại trạng thái (chính); unique index (phụ) |
| Chỉ chủ đơn | 036 | `WHERE id = ? AND publisherUserId = ?` — không khớp ⇒ 404 |

---

## 7. Thứ tự thao tác trong transaction tạo đơn

```
1. assertActivePublisher()            ← ngoài transaction, chưa giữ khoá nào
2. probe idempotency (chốt 1)         ← ngoài transaction
   ┌─ BEGIN ─────────────────────────────────────────────────
3. │ lock Profile FOR UPDATE                    ← khoá DUY NHẤT, luôn trước (R2)
4. │ probe idempotency (chốt 2)
5. │ đọc WITHDRAWAL_MIN_AMOUNT        ← lỗi hạ tầng phải ném nguyên dạng (FR-012a)
6. │ kiểm amount >= min
7. │ SELECT max("createdAt"), now() → kiểm 24 giờ ← KHÔNG FOR UPDATE (R3)
   │   └─ SO SÁNH BẰNG now() CỦA DATABASE, không bằng đồng hồ ứng dụng
8. │ UPDATE Profile ... AND balance >= amount RETURNING balance
   │   └─ không khớp dòng nào ⇒ 422 không đủ số dư
9. │ INSERT WithdrawalRequest → lấy id
10.│ walletService.recordWithdrawal({ withdrawalRequestId, balanceAfter })
   └─ COMMIT ───────────────────────────────────────────────
11. đọc lại đơn và trả về
```

**Bước 9 phải trước bước 10**: bút toán mang `withdrawalRequestId`, mà id chỉ tồn tại sau khi dòng
đơn được ghi. Giống hệt `order.service.ts:285` ghi Order trước rồi mới ghi 3 bút toán.

### Transaction huỷ đơn

```
   ┌─ BEGIN ─────────────────────────────────────────────────
1. │ lock Profile FOR UPDATE                    ← vẫn Profile trước (R2)
2. │ UPDATE "WithdrawalRequest"
   │    SET status = 'CANCELLED', "processedAt" = now()
   │  WHERE id = ? AND "publisherUserId" = ? AND status = 'PENDING'
   │  RETURNING id, amount                      ← ĐIỀU KIỆN NẰM TRONG CÂU LỆNH (R8)
   │   └─ 0 dòng ⇒ không tồn tại / của người khác / không còn PENDING
   │       ├─ đơn có tồn tại và là của mình ⇒ 409 WithdrawalNotPending
   │       └─ còn lại                        ⇒ 404 WithdrawalNotFound
3. │ creditUserBalance() → balanceAfter          ← hàm đã có sẵn
4. │ walletService.recordWithdrawalReversal({ withdrawalRequestId, balanceAfter })
   └─ COMMIT ───────────────────────────────────────────────
```

**Không có phép đọc riêng nào trước khi ghi.** Bước 2 vừa kiểm vừa ghi trong một câu lệnh, nên
không tồn tại cửa sổ nào để một lệnh huỷ khác chen vào. Lệnh huỷ thứ hai chạy song song bị chặn ở
khoá dòng mà `UPDATE` đầu đang giữ, rồi đánh giá lại `WHERE` sau khi lệnh đầu commit
(`READ COMMITTED`), khớp **0 dòng** → nhận câu trả lời nghiệp vụ. Bút toán hoàn tiền **chỉ chạy khi
bước 2 trả về một dòng**, nên không bao giờ chạm tới unique index.

Để phân biệt 404 với 409 khi `UPDATE` khớp 0 dòng, đọc lại đơn **sau đó** bằng một `SELECT` thường
— lúc này chỉ để chọn thông điệp lỗi, không còn ảnh hưởng tới tính đúng đắn.

---

## 8. Phép đối soát phải cập nhật

Năm phép hiện có ở `docs/deployment-runbook.md`. Thay đổi:

- **(a) ví người dùng khớp sổ** — không đổi công thức, nhưng nay sổ có thêm 2 loại bút toán nên
  phép cộng dồn `CREDIT − DEBIT` tự động bao gồm chúng. **Không cần sửa.**
- **(e) báo cáo dòng tiền** — **phải sửa**, thêm hai túi theo R10.
- Thêm **(f) mới**: tổng đơn chưa hoàn phải khớp hiệu giữa tổng đã trừ và tổng đã hoàn (SC-002).

```sql
-- (f) MỚI — đơn chưa hoàn khớp với sổ cái.
SELECT
  (SELECT COALESCE(SUM(amount),0) FROM "WithdrawalRequest"
    WHERE status <> 'CANCELLED' AND status <> 'REJECTED')        AS tu_don,
  (SELECT COALESCE(SUM(amount),0) FROM "WalletTransaction"
    WHERE type = 'WITHDRAWAL')
  - (SELECT COALESCE(SUM(amount),0) FROM "WalletTransaction"
    WHERE type = 'WITHDRAWAL_REVERSAL')                          AS tu_so_cai;
-- Hai cột phải bằng nhau.
```
