-- Order: one purchase paid from the customer's balance, and its immutable line.
-- Spec: specs/007-order (spec.md, data-model.md, research.md).
--
-- Decisions encoded here:
--   * "OrderStatus" holds only PAID. A purchase that fails rolls back and leaves no row,
--     so PENDING, CANCELLED and FAILED would be values nothing ever writes. "paidAt" is
--     NOT NULL, which is stronger than a CHECK tying it to the status.
--   * UNIQUE ("customerId", "idempotencyKey") is the last line of defence against a double
--     charge; the key is UUID rather than text so an upper-case replay is the same key.
--   * "offerSnapshot" freezes the commercial terms at purchase time: a later price edit or
--     a dropped offer cannot rewrite what the customer agreed to.
--   * The table name is a SQL keyword, so every reference quotes it.
--   * Closes the debt from migration 20261121090000_add_entitlement: "latestOrderItemId"
--     was created without a foreign key because OrderItem did not exist yet. The column is
--     still NULL everywhere, so the constraint needs no backfill.

CREATE TYPE "OrderStatus" AS ENUM (
    'PAID'
);

CREATE TABLE "Order" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "customerId" UUID NOT NULL REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    status "OrderStatus" NOT NULL DEFAULT 'PAID',
    "totalAmount" BIGINT NOT NULL,
    "paidAt" TIMESTAMPTZ(6) NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "Order_totalAmount_check" CHECK ("totalAmount" >= 0)
);

CREATE UNIQUE INDEX "Order_customerId_idempotencyKey_key"
ON "Order" ("customerId", "idempotencyKey");

-- Serves the customer's own history, newest first.
CREATE INDEX "Order_customerId_createdAt_idx"
ON "Order" ("customerId", "createdAt" DESC);

CREATE TABLE "OrderItem" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL REFERENCES "Order" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "productId" UUID NOT NULL REFERENCES "Product" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "productOfferId" UUID NOT NULL REFERENCES "ProductOffer" (id)
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    "unitPriceAmount" BIGINT NOT NULL,
    "offerSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "OrderItem_unitPriceAmount_check" CHECK ("unitPriceAmount" >= 0),
    CONSTRAINT "OrderItem_offerSnapshot_object_check"
        CHECK (jsonb_typeof("offerSnapshot") = 'object')
);

CREATE UNIQUE INDEX "OrderItem_orderId_productId_key"
ON "OrderItem" ("orderId", "productId");

CREATE INDEX "OrderItem_orderId_idx"   ON "OrderItem" ("orderId");
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem" ("productId");

ALTER TABLE "Entitlement"
    ADD CONSTRAINT "Entitlement_latestOrderItemId_fkey"
    FOREIGN KEY ("latestOrderItemId") REFERENCES "OrderItem" (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION;
