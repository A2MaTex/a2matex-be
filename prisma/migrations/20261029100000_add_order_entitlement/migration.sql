-- Order, payment record and Entitlement: what a customer buys and what it grants.
-- Spec: a2matex-docs/components/a2matex-backend/db_design/04_commerce_entitlement_execution.md §3-4
--
-- Decisions encoded here:
--   * A paid Offer is settled against the wallet, so "PaymentTransaction" is the first
--     ledger of money leaving "Profile"."balance"; "TopUpTransaction" only records money
--     arriving. Its unique (provider, providerTransactionId) index is what stops the same
--     Order from being charged twice.
--   * "Entitlement" carries its own limits instead of reading them back from the Offer:
--     a Publisher editing a price or a device limit must not change rights already granted.
--   * One ACTIVE Entitlement per (customer, product) is the final guard against a double
--     purchase, under the application lock rather than instead of it.

CREATE TYPE "OrderStatus" AS ENUM (
    'PENDING',
    'PAID',
    'CANCELLED',
    'FAILED'
);

CREATE TYPE "PaymentStatus" AS ENUM (
    'PENDING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED'
);

CREATE TYPE "EntitlementStatus" AS ENUM (
    'ACTIVE',
    'EXPIRED',
    'REVOKED'
);

CREATE TYPE "EntitlementGrantSource" AS ENUM (
    'FREE_ACQUISITION',
    'ORDER',
    'ADMIN_GRANT'
);

CREATE TABLE "Order" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "customerId" UUID NOT NULL REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    status "OrderStatus" NOT NULL DEFAULT 'PENDING',
    currency CHAR(3) NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "paidAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Order_totalMinor_check" CHECK ("totalMinor" >= 0),
    CONSTRAINT "Order_paidAt_check" CHECK (status <> 'PAID' OR "paidAt" IS NOT NULL)
);

CREATE TABLE "OrderItem" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL REFERENCES "Order" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "productId" UUID NOT NULL REFERENCES "Product" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "productOfferId" UUID NOT NULL REFERENCES "ProductOffer" (id)
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    "unitPriceMinor" BIGINT NOT NULL,

    -- Mock JSON: immutable commercial snapshot.
    -- {
    --   "schemaVersion": "1.0",
    --   "offerType": "ONE_TIME",
    --   "currency": "VND",
    --   "priceMinor": 199000,
    --   "durationDays": null,
    --   "maxConcurrentDevices": 3
    -- }
    "offerSnapshot" JSONB NOT NULL,

    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "OrderItem_order_product_key" UNIQUE ("orderId", "productId"),
    CONSTRAINT "OrderItem_unitPriceMinor_check" CHECK ("unitPriceMinor" >= 0),
    CONSTRAINT "OrderItem_offerSnapshot_object_check"
        CHECK (jsonb_typeof("offerSnapshot") = 'object')
);

CREATE TABLE "PaymentTransaction" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL REFERENCES "Order" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    provider VARCHAR(100) NOT NULL,
    "providerTransactionId" VARCHAR(255),
    status "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    currency CHAR(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,

    -- Mock JSON: sanitized provider result only, never credentials or raw webhooks.
    -- {"schemaVersion": "1.0", "settledFrom": "WALLET"}
    "providerResult" JSONB NOT NULL DEFAULT '{}'::JSONB,

    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ(6),

    CONSTRAINT "PaymentTransaction_amountMinor_check" CHECK ("amountMinor" >= 0),
    CONSTRAINT "PaymentTransaction_providerResult_object_check"
        CHECK (jsonb_typeof("providerResult") = 'object')
);

CREATE UNIQUE INDEX "PaymentTransaction_provider_id_idx"
ON "PaymentTransaction" (provider, "providerTransactionId")
WHERE "providerTransactionId" IS NOT NULL;

CREATE TABLE "Entitlement" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "customerId" UUID NOT NULL REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "productId" UUID NOT NULL REFERENCES "Product" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "productOfferId" UUID REFERENCES "ProductOffer" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "orderItemId" UUID REFERENCES "OrderItem" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    status "EntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
    "grantSource" "EntitlementGrantSource" NOT NULL,
    "startsAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "expiresAt" TIMESTAMPTZ(6),
    "maxConcurrentDevices" INTEGER NOT NULL,

    -- Mock JSON: immutable snapshot of the rights granted.
    -- {
    --   "schemaVersion": "1.0",
    --   "offerType": "SUBSCRIPTION",
    --   "releaseAccess": "CURRENT_AND_SUPPORTED",
    --   "allowUpdates": true
    -- }
    "grantSnapshot" JSONB NOT NULL,

    "grantedById" UUID REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "revokedAt" TIMESTAMPTZ(6),
    "revokedById" UUID REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "revokedReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Entitlement_maxConcurrentDevices_check" CHECK ("maxConcurrentDevices" > 0),
    CONSTRAINT "Entitlement_period_check"
        CHECK ("expiresAt" IS NULL OR "expiresAt" > "startsAt"),
    CONSTRAINT "Entitlement_grantSnapshot_object_check"
        CHECK (jsonb_typeof("grantSnapshot") = 'object'),
    CONSTRAINT "Entitlement_revoke_fields_check" CHECK (
        status <> 'REVOKED'
        OR ("revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL AND "revokedReason" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "Entitlement_active_customer_product_idx"
ON "Entitlement" ("customerId", "productId")
WHERE status = 'ACTIVE';

-- Checkout reads every Entitlement of the pair, not only the ACTIVE one: a revoked
-- Entitlement must keep the customer out.
CREATE INDEX "Entitlement_customer_product_idx"
ON "Entitlement" ("customerId", "productId");
