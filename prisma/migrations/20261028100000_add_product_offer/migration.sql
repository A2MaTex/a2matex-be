-- Product Offer: the commercial terms on which a customer may acquire a Product.
-- Spec: a2matex-docs/components/a2matex-backend/db_design/04_commerce_entitlement_execution.md §2
--
-- Only the entity the Offer API needs lands here. Order, OrderItem, PaymentTransaction
-- and Entitlement arrive with the checkout slice, per db_design/README.md ("Mỗi vertical
-- slice chỉ lấy entity/constraint thực sự cần cho API đang triển khai").
--
-- Decisions encoded here:
--   * At most one ACTIVE Offer per Product, so checkout never has to pick between two
--     live prices. Older Offers stay as INACTIVE history for the Orders that cite them.
--   * A paid Offer must carry a price strictly greater than zero. The design SQL only
--     requires `priceMinor >= 0`; a paid Offer priced at zero is a FREE Offer wearing the
--     wrong type, and the Order total would disagree with the Offer type forever.
--   * `durationDays` belongs to SUBSCRIPTION alone. FREE and ONE_TIME grant Entitlements
--     with no expiry, so carrying a duration there would silently expire a perpetual grant.

CREATE TYPE "ProductOfferType" AS ENUM (
    'FREE',
    'ONE_TIME',
    'SUBSCRIPTION'
);

CREATE TYPE "ProductOfferStatus" AS ENUM (
    'DRAFT',
    'ACTIVE',
    'INACTIVE'
);

CREATE TABLE "ProductOffer" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "productId" UUID NOT NULL REFERENCES "Product" (id)
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    type "ProductOfferType" NOT NULL,
    status "ProductOfferStatus" NOT NULL DEFAULT 'DRAFT',
    currency CHAR(3),
    "priceMinor" BIGINT,
    "durationDays" INTEGER,
    "maxConcurrentDevices" INTEGER NOT NULL DEFAULT 1,

    -- Mock JSON:
    -- {
    --   "schemaVersion": "1.0",
    --   "releaseAccess": "CURRENT_AND_SUPPORTED",
    --   "allowUpdates": true
    -- }
    "usagePolicy" JSONB NOT NULL DEFAULT '{}'::JSONB,

    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),
    "createdById" UUID NOT NULL REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "updatedById" UUID REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,

    CONSTRAINT "ProductOffer_maxConcurrentDevices_check"
        CHECK ("maxConcurrentDevices" > 0),
    CONSTRAINT "ProductOffer_usagePolicy_object_check"
        CHECK (jsonb_typeof("usagePolicy") = 'object'),

    -- Both directions: a FREE Offer costs nothing and names no currency, a paid Offer
    -- carries both.
    CONSTRAINT "ProductOffer_price_check" CHECK (
        (
            type = 'FREE'
            AND COALESCE("priceMinor", 0) = 0
            AND currency IS NULL
        )
        OR (
            type <> 'FREE'
            AND "priceMinor" IS NOT NULL
            AND "priceMinor" > 0
            AND currency IS NOT NULL
        )
    ),

    CONSTRAINT "ProductOffer_duration_check" CHECK (
        (type = 'SUBSCRIPTION' AND "durationDays" IS NOT NULL AND "durationDays" > 0)
        OR
        (type <> 'SUBSCRIPTION' AND "durationDays" IS NULL)
    )
);

CREATE INDEX "ProductOffer_product_status_idx"
ON "ProductOffer" ("productId", status)
WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "ProductOffer_single_active_idx"
ON "ProductOffer" ("productId")
WHERE "deletedAt" IS NULL AND status = 'ACTIVE';
