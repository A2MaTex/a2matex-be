-- Đơn rút tiền của nhà phát hành — đường tiền ra đầu tiên của hệ thống.
--
-- Hai giá trị enum WITHDRAWAL / WITHDRAWAL_REVERSAL thêm ở migration trước và được DÙNG ở
-- đây (accountKind_check), nên hai file không gộp được.

-- B1. Trạng thái đơn, khai đủ năm giá trị ngay dù lát cắt này chỉ sinh PENDING/CANCELLED.
CREATE TYPE "WithdrawalRequestStatus" AS ENUM (
    'PENDING', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED'
);

-- B2. Bảng đơn rút tiền. Không có deletedAt: đây là chứng từ tiền, CANCELLED là cách huỷ.
CREATE TABLE "WithdrawalRequest" (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Trỏ User chứ không PublisherAccount: ví nằm trên Profile.userId.
    "publisherUserId"   UUID NOT NULL REFERENCES "User" (id) ON DELETE NO ACTION,

    amount              BIGINT NOT NULL,
    status              "WithdrawalRequestStatus" NOT NULL DEFAULT 'PENDING',

    -- Bản chụp: đổi thông tin ngân hàng về sau không được làm đổi đơn đã chi.
    "bankAccountNumber" VARCHAR(50)  NOT NULL,
    "bankName"          VARCHAR(255) NOT NULL,
    "bankAccountHolder" VARCHAR(255) NOT NULL,

    "idempotencyKey"    UUID NOT NULL,

    -- Admin nhập tay sau khi chuyển khoản; lát cắt này chỉ khai chỗ chứa.
    "bankTransferRef"   TEXT,
    "rejectionReason"   TEXT,

    -- Mốc neo của quy tắc 24 giờ.
    "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    "processedAt"       TIMESTAMPTZ,
    "processedById"     UUID REFERENCES "User" (id) ON DELETE NO ACTION,

    CONSTRAINT "WithdrawalRequest_amount_check" CHECK (amount > 0),

    -- Không ép processedById: nhà phát hành tự huỷ thì không có admin nào để điền.
    CONSTRAINT "WithdrawalRequest_processed_check" CHECK (
           (status =  'PENDING' AND "processedAt" IS NULL)
        OR (status <> 'PENDING' AND "processedAt" IS NOT NULL)
    ),

    CONSTRAINT "WithdrawalRequest_transferRef_check" CHECK (
        "bankTransferRef" IS NULL OR status = 'PAID'
    ),

    CONSTRAINT "WithdrawalRequest_rejection_check" CHECK (
        "rejectionReason" IS NULL OR status = 'REJECTED'
    )
);

-- B3. Chống lặp theo từng người: hai nhà phát hành trùng khoá là bình thường.
CREATE UNIQUE INDEX "WithdrawalRequest_publisher_idempotency_key"
ON "WithdrawalRequest" ("publisherUserId", "idempotencyKey");

-- Phục vụ cả danh sách đơn lẫn phép kiểm mốc 24 giờ.
CREATE INDEX "WithdrawalRequest_publisher_createdAt_idx"
ON "WithdrawalRequest" ("publisherUserId", "createdAt" DESC);

-- B4. Sổ cái nhận thêm một loại chứng từ nguồn.
ALTER TABLE "WalletTransaction"
    ADD COLUMN "withdrawalRequestId" UUID
    REFERENCES "WithdrawalRequest" (id) ON DELETE NO ACTION;

-- Nhiều nhất một bút toán mỗi loại cho mỗi đơn, giống WalletTransaction_order_type_key.
-- LỚP PHÒNG THỦ THỨ HAI cho việc hoàn tiền hai lần — để nó bắt thì người dùng nhận 500.
-- Cơ chế chính là câu UPDATE có điều kiện ở withdrawal.repo.ts.
CREATE UNIQUE INDEX "WalletTransaction_withdrawal_type_key"
ON "WalletTransaction" ("withdrawalRequestId", type)
WHERE "withdrawalRequestId" IS NOT NULL;

-- KHÔNG thêm index riêng cho ("withdrawalRequestId"): unique index trên đã có cột đó đứng
-- đầu nên phục vụ mọi tra cứu theo đơn.

-- B5. Loại nào ở phía nào, chiều nào — thêm hai tổ hợp, thành chín.
ALTER TABLE "WalletTransaction" DROP CONSTRAINT "WalletTransaction_accountKind_check";
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_accountKind_check" CHECK (
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
    OR (type = 'WITHDRAWAL'
            AND direction = 'DEBIT'  AND "userId" IS NOT NULL)
    OR (type = 'WITHDRAWAL_REVERSAL'
            AND direction = 'CREDIT' AND "userId" IS NOT NULL)
);

-- B6. Chứng từ nguồn. VIẾT LẠI TOÀN BỘ: mỗi nhánh cũ phải tự khẳng định
-- "withdrawalRequestId" IS NULL, nếu không một dòng ADMIN_GRANT vẫn mang được nó và ràng
-- buộc cho qua. Bẫy im lặng — không truy vấn nào báo lỗi, chỉ dữ liệu bẩn dần.
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

-- B7. WalletTransaction_actor_check KHÔNG ĐỔI, cố ý: thêm WITHDRAWAL_REVERSAL vào danh
-- sách "phải có createdById + note" sẽ chặn đúng đường nhà phát hành tự huỷ. Lát cắt duyệt
-- đơn phải phân biệt bằng trạng thái của đơn, không bằng loại bút toán.

-- B8. Mức rút tối thiểu. Tạo ở migration giống COMMISSION_RATE_BPS, không phải ở seed
-- script (seed-system-settings.ts chỉ bắc cầu ba giá trị ngân hàng từ env). Lưu bằng CHUỖI
-- vì tiền trong hệ thống là BIGINT.
INSERT INTO "SystemSetting" (key, value) VALUES
    ('WITHDRAWAL_MIN_AMOUNT', '{"amount": "100000"}');

-- `value ? 'amount'` BẮT BUỘC đứng đầu: thiếu khoá thì `value ->> 'amount'` ra NULL, cả
-- CHECK ra NULL, và Postgres coi NULL là đạt — `SET value = '{}'` sẽ đi lọt.
ALTER TABLE "SystemSetting" ADD CONSTRAINT "SystemSetting_withdrawalMin_check" CHECK (
    key <> 'WITHDRAWAL_MIN_AMOUNT'
    OR (
        value ? 'amount'
        AND (value ->> 'amount') ~ '^[0-9]{1,19}$'
        AND (value ->> 'amount')::numeric BETWEEN 1 AND 9223372036854775807
    )
);
