-- Order revenue split: how much of each purchase the Marketplace keeps and how much the
-- Publisher receives. Spec: specs/010-commission-split.
--
-- Decisions encoded here:
--   * All four values are frozen on the Order, same reason "offerSnapshot" is: an Admin
--     can change the commission rate at any time and that must never rewrite history.
--   * "publisherUserId" is denormalised. It is reachable through
--     productId -> Product.publisherAccountId -> PublisherAccount.userId, but product
--     ownership can change and a sale must stay attributable to whoever took the money.
--   * The split CHECK covers every write path, including raw SQL. Unlike the commission
--     rate in SystemSetting, all three values are real columns, so nothing slips past it.
--   * No CHECK that publisher <> customer: self-purchase is blocked from now on, but two
--     such Orders already exist and a constraint would make this migration unrunnable.
--
-- Three steps, in this order. The CHECK cannot exist before the backfill or the backfill
-- would violate it, and the columns cannot start NOT NULL because the table has rows.

-- Step 1: add the columns, nullable for now.
ALTER TABLE "Order"
    ADD COLUMN "publisherUserId" UUID REFERENCES "User" (id) ON DELETE NO ACTION,
    ADD COLUMN "commissionRateBps" INTEGER,
    ADD COLUMN "commissionAmount" BIGINT,
    ADD COLUMN "publisherAmount" BIGINT;

-- Step 2: fill the Orders that already exist.
--
-- Everything goes to the platform and the Publisher share is zero, because no money has
-- ever reached a Publisher wallet for these sales. Recording any other rate would freeze a
-- number into history that never happened. The repo owner confirmed on 2026-11-23 that the
-- existing Orders are his own test purchases, so nobody is owed a payout.
--
-- There is deliberately no UPDATE on "Profile" here: this migration moves no money.
UPDATE "Order" o
SET "publisherUserId"   = pa."userId",
    "commissionRateBps" = 10000,
    "commissionAmount"  = o."totalAmount",
    "publisherAmount"   = 0
FROM "Product" p
JOIN "PublisherAccount" pa ON pa.id = p."publisherAccountId"
WHERE p.id = o."productId"
  AND o."publisherUserId" IS NULL;

-- Step 3: tighten.
ALTER TABLE "Order"
    ALTER COLUMN "publisherUserId" SET NOT NULL,
    ALTER COLUMN "commissionRateBps" SET NOT NULL,
    ALTER COLUMN "commissionAmount" SET NOT NULL,
    ALTER COLUMN "publisherAmount" SET NOT NULL,
    ADD CONSTRAINT "Order_commissionRateBps_check"
        CHECK ("commissionRateBps" >= 0 AND "commissionRateBps" <= 10000),
    ADD CONSTRAINT "Order_split_exact_check"
        CHECK ("commissionAmount" >= 0
           AND "publisherAmount" >= 0
           AND "commissionAmount" + "publisherAmount" = "totalAmount");

-- Serves the Publisher earnings list.
CREATE INDEX "Order_publisherUserId_createdAt_idx"
ON "Order" ("publisherUserId", "createdAt" DESC);
