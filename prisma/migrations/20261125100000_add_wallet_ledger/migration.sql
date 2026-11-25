-- Sổ cái ví và tài khoản tiền của sàn (spec 011, phase 3 của module payout).
--
-- File này làm hai việc, theo đúng thứ tự:
--   A. Tạo bảng, enum, ràng buộc và index.
--   B. Dựng lại lịch sử cho dữ liệu đã có, kèm hai chốt dừng.
--
-- Chạy lại được: mọi câu chèn ở phần B có ON CONFLICT DO NOTHING dựa trên index duy nhất.
--
-- ĐIỀU KIỆN TRƯỚC KHI CHẠY TRÊN PRODUCTION: bước dọn dữ liệu trong
-- docs/deployment-runbook.md phải chạy xong và truy vấn đối soát (a) phải ra 0 dòng.
-- Không còn cơ chế bù trừ nào, nên mọi tài khoản phải khớp tuyệt đối — hai chốt dừng ở
-- phần B sẽ dừng migration nếu không.

-- ============================================================================
-- A. Bảng, enum, ràng buộc, index
-- ============================================================================

CREATE TYPE "WalletTransactionType" AS ENUM (
    'TOPUP', 'PURCHASE', 'EARNING', 'COMMISSION', 'ADMIN_GRANT', 'ISSUED_CREDIT'
);

CREATE TYPE "WalletDirection" AS ENUM ('CREDIT', 'DEBIT');

-- Đúng một giá trị là cố ý (Nguyên tắc VI). Thêm giá trị sau này không đụng bản ghi đã có.
CREATE TYPE "SystemAccountType" AS ENUM ('PLATFORM_REVENUE');

-- Tiền của sàn. Không thuộc về người dùng nào: nếu nó là một tài khoản người dùng thì chỉ
-- cần ai đó xoá mềm tài khoản ấy là nó rơi khỏi phép đối soát mà phép đối soát vẫn báo
-- sạch. Khoá chính là chính cột type — đây là tập hợp cố định các tài khoản có tên, không
-- phải danh sách bản ghi sinh ra theo thời gian.
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
    -- Ràng buộc không-âm cho cột này nằm ở cuối file, sau khi dựng xong lịch sử: phần B
    -- chèn giá trị tạm 0 và chỉ bước cuối mới điền số thật.
    "balanceAfter"       BIGINT NOT NULL,
    "orderId"            UUID REFERENCES "Order" (id) ON DELETE NO ACTION,
    "topUpTransactionId" UUID REFERENCES "TopUpTransaction" (id) ON DELETE NO ACTION,
    "transferId"         UUID,
    note                 TEXT,
    "createdById"        UUID REFERENCES "User" (id) ON DELETE NO ACTION,
    "createdAt"          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "WalletTransaction_amount_check" CHECK (amount > 0),

    -- Đúng một phía: ví người dùng HOẶC tài khoản hệ thống. Khoá ngoại vẫn kiểm mọi giá
    -- trị không rỗng; CHECK này làm bất biến trở nên toàn phần.
    CONSTRAINT "WalletTransaction_account_check" CHECK (
        (("userId" IS NOT NULL)::int + ("systemAccount" IS NOT NULL)::int) = 1
    ),

    -- Loại nào ở phía nào, chiều nào. Ràng buộc gánh phần nặng nhất của cả thiết kế: hai
    -- nhánh cuối khoá chân trừ của ADMIN_GRANT vào tài khoản hệ thống, nên "quản trị viên
    -- chỉ cho đi được tiền sàn đang có" là điều chứng minh được bằng truy vấn.
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

-- Một đơn sinh nhiều nhất một bút toán mỗi loại. Một lần chạy lại chạm tới đây thay vì
-- nhân đôi số tiền; loại khác nhau là thứ cho phép ba bút toán của cùng một đơn sống cạnh nhau.
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

-- ============================================================================
-- B. Dựng lại lịch sử cho dữ liệu đã có
--
-- Mỗi câu chèn có ON CONFLICT DO NOTHING dựa trên index duy nhất ở phần A: đó là chốt
-- chặn chạy trùng. Cột "balanceAfter" chèn giá trị TẠM 0; bước B5 mới điền số thật, và
-- ràng buộc không-âm cho cột đó thêm ở B7 nên giá trị tạm hợp lệ tới lúc ấy.
-- ============================================================================

-- B1. Nạp tiền.
INSERT INTO "WalletTransaction"
    ("userId", type, direction, amount, "balanceAfter", "topUpTransactionId", "createdAt")
SELECT t."userId", 'TOPUP', 'CREDIT', t."receivedAmount", 0, t.id, t."creditedAt"
FROM "TopUpTransaction" t
WHERE t."creditedAt" IS NOT NULL
  AND t."userId" IS NOT NULL
  AND COALESCE(t."receivedAmount", 0) > 0
ON CONFLICT DO NOTHING;

-- B2. Mua hàng.
INSERT INTO "WalletTransaction"
    ("userId", type, direction, amount, "balanceAfter", "orderId", "createdAt")
SELECT o."customerId", 'PURCHASE', 'DEBIT', o."totalAmount", 0, o.id, o."paidAt"
FROM "Order" o
WHERE o."totalAmount" > 0
ON CONFLICT DO NOTHING;

-- B3. Tiền bán hàng về ví nhà phát hành.
-- Trên production tại thời điểm viết, bước này sinh 0 dòng: phase 2 đã ghi mọi đơn cũ về
-- phía sàn nên publisherAmount = 0 trên toàn bộ. Vẫn phải viết — database local và các đơn
-- từ nay về sau không như vậy.
INSERT INTO "WalletTransaction"
    ("userId", type, direction, amount, "balanceAfter", "orderId", "createdAt")
SELECT o."publisherUserId", 'EARNING', 'CREDIT', o."publisherAmount", 0, o.id, o."paidAt"
FROM "Order" o
WHERE o."publisherAmount" > 0
ON CONFLICT DO NOTHING;

-- B4. Hoa hồng của sàn — một bút toán cho TỪNG đơn, không phải một khoản gộp, để tài khoản
-- của sàn không có bản ghi nào thiếu nguồn gốc.
INSERT INTO "WalletTransaction"
    ("systemAccount", type, direction, amount, "balanceAfter", "orderId", "createdAt")
SELECT 'PLATFORM_REVENUE', 'COMMISSION', 'CREDIT', o."commissionAmount", 0, o.id, o."paidAt"
FROM "Order" o
WHERE o."commissionAmount" > 0
ON CONFLICT DO NOTHING;

UPDATE "SystemAccount"
SET balance = (
        SELECT COALESCE(SUM(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END), 0)
        FROM "WalletTransaction"
        WHERE "systemAccount" = 'PLATFORM_REVENUE'
    ),
    "updatedAt" = now()
WHERE type = 'PLATFORM_REVENUE';

-- GHI CHÚ: MỘT BƯỚC CỐ Ý KHÔNG NẰM TRONG REPO (2026-11-25)
--
-- Trên production có hai ví mang số dư quản trị viên đặt thẳng vào dữ liệu trước khi có sổ
-- cái. Bước ghi lại khoản đó phải hardcode UUID của hai người dùng thật và của tài khoản
-- quản trị viên, nên nó KHÔNG nằm trong repo: nó chạy một lần, bằng tay, cùng transaction
-- với file này — xem docs/deployment-runbook.md mục B9.1.
--
-- Hệ quả cho database KHÁC production: không có gì phải làm. Database rỗng hoặc database
-- của máy cá nhân không có khoản số dư không giải thích được nào, nên hai chốt dừng dưới
-- đây đi qua bình thường.

-- B5. CHỐT DỪNG 1 — ví nào lịch sử cộng ra NHIỀU HƠN số dư thật.
-- Không còn cơ chế bù trừ chiều âm, và quản trị viên trừ tiền nằm ngoài phạm vi phase này,
-- nên không có đường nào xử lý tự động. Dừng ở đây đắt hơn nhiều so với phát hiện sau.
DO $wallet_gate_1$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(
               x."userId"::text || ' (lịch sử ' || x.ledger || ' > số dư ' || x.balance || ')',
               ', ')
    INTO offenders
    FROM (
        SELECT pr."userId", pr.balance,
               COALESCE(SUM(CASE w.direction WHEN 'CREDIT' THEN w.amount
                                             ELSE -w.amount END), 0) AS ledger
        FROM "Profile" pr
        LEFT JOIN "WalletTransaction" w ON w."userId" = pr."userId"
        -- CỐ Ý không lọc deletedAt: B2 dựng bút toán PURCHASE cho MỌI đơn bất kể chủ ví
        -- còn hay đã xoá mềm, và B7/B8 chạy trên mọi dòng. Lọc ở đây thì một ví đã xoá mềm
        -- mang số dư đặt tay sẽ lọt qua cả hai chốt, rồi migration gãy ở ràng buộc không-âm
        -- với một thông báo trơ trụi — đúng thứ hai chốt này sinh ra để tránh.
        GROUP BY pr."userId", pr.balance
    ) x
    WHERE x.ledger > x.balance;

    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION
            'Lich su dung lai VUOT so du that o cac vi: %. Phase nay khong co co che bu tru chieu am, va quan tri vien tru tien nam ngoai pham vi. Dieu tra vi sao vi do lech truoc khi lam gi tiep. Xem docs/deployment-runbook.md muc B9.',
            offenders;
    END IF;
END
$wallet_gate_1$;

-- B6. CHỐT DỪNG 2 — còn bất kỳ tài khoản nào lệch.
-- Đây là khác biệt lớn nhất so với bản thiết kế ngày 2026-11-24: khi còn "số dư mở đầu",
-- mọi chênh lệch đều được hấp thụ; nay mọi tài khoản phải khớp tuyệt đối (SC-001).
DO $wallet_gate_2$
DECLARE
    offenders text;
    system_gap bigint;
BEGIN
    SELECT string_agg(
               x."userId"::text || ' (số dư ' || x.balance || ' ≠ lịch sử ' || x.ledger || ')',
               ', ')
    INTO offenders
    FROM (
        SELECT pr."userId", pr.balance,
               COALESCE(SUM(CASE w.direction WHEN 'CREDIT' THEN w.amount
                                             ELSE -w.amount END), 0) AS ledger
        FROM "Profile" pr
        LEFT JOIN "WalletTransaction" w ON w."userId" = pr."userId"
        -- CỐ Ý không lọc deletedAt: B2 dựng bút toán PURCHASE cho MỌI đơn bất kể chủ ví
        -- còn hay đã xoá mềm, và B7/B8 chạy trên mọi dòng. Lọc ở đây thì một ví đã xoá mềm
        -- mang số dư đặt tay sẽ lọt qua cả hai chốt, rồi migration gãy ở ràng buộc không-âm
        -- với một thông báo trơ trụi — đúng thứ hai chốt này sinh ra để tránh.
        GROUP BY pr."userId", pr.balance
    ) x
    WHERE x.ledger <> x.balance;

    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION
            'Sau khi dung lai, cac vi sau van lech: %. Day la vi NGOAI danh sach o buoc B5. Dieu tra vi sao truoc khi them vao danh sach do - B5 la ngoai le co gioi han da duoc xac nhan, khong phai cua sau. Xem docs/deployment-runbook.md muc B9.',
            offenders;
    END IF;

    SELECT sa.balance - COALESCE(SUM(CASE w.direction WHEN 'CREDIT' THEN w.amount
                                                      ELSE -w.amount END), 0)
    INTO system_gap
    FROM "SystemAccount" sa
    LEFT JOIN "WalletTransaction" w ON w."systemAccount" = sa.type
    WHERE sa.type = 'PLATFORM_REVENUE'
    GROUP BY sa.balance;

    IF COALESCE(system_gap, 0) <> 0 THEN
        RAISE EXCEPTION
            'Tai khoan cua san lech % so voi lich su cua chinh no.', system_gap;
    END IF;
END
$wallet_gate_2$;

-- B7. Điền số dư sau bằng tổng luỹ kế.
-- Phân hoạch theo COALESCE("userId", "systemAccount") vì hai loại tài khoản nằm chung bảng.
-- Thứ tự phụ (loại, rồi id) là thứ làm kết quả LẶP LẠI ĐƯỢC khi hai mốc thời gian trùng
-- nhau: thiếu nó, hai lần chạy có thể cho hai chuỗi số dư khác nhau mà tổng vẫn đúng.
WITH ordered AS (
    SELECT id,
           SUM(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END)
             OVER (PARTITION BY COALESCE("userId"::text, "systemAccount"::text)
                   ORDER BY "createdAt",
                            -- Mọi khoản ghi CÓ đứng trước mọi khoản ghi NỢ. COMMISSION là
                            -- khoản ghi có DUY NHẤT nuôi tài khoản của sàn, nên để nó rơi vào
                            -- ELSE (sau chân nợ của ADMIN_GRANT) là mời số dư ví sàn đi qua
                            -- vùng âm khi hai dòng trùng mốc thời gian.
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
FROM ordered o
WHERE o.id = w.id;

-- B8. Hai ràng buộc không-âm, thêm SAU khi lịch sử đã xong.
-- Nếu B7 dựng ra một đoạn âm ở giữa thì migration dừng ngay tại đây — đó là tín hiệu dữ
-- liệu nguồn không đỡ nổi một ví không-âm, chứ không phải lỗi thiết kế.
ALTER TABLE "WalletTransaction"
    ADD CONSTRAINT "WalletTransaction_balanceAfter_check" CHECK ("balanceAfter" >= 0);

ALTER TABLE "Profile"
    ADD CONSTRAINT "Profile_balance_check" CHECK (balance >= 0);
