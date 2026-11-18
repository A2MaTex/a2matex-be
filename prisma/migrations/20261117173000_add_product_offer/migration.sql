-- Product Offer: the ways a customer may currently acquire one Product.
-- Spec: a2matex-docs/components/a2matex-backend/commerce_entitlement_execution/product_offer.md
--
-- Decisions encoded here:
--   * No status column and no type/price/duration CHECK. Availability is
--     "deletedAt IS NULL" plus Product eligibility, and the replacement API validates the
--     whole desired set against its own type rules before it writes anything.
--   * "offerChangeTimestamps" holds the sliding window the Backend prunes and appends
--     under the Product row lock. It stays bounded by PRODUCT_OFFER_CHANGE_MAX_COUNT.
--   * One index only: the Product lookup returns a bounded collection and the diff by
--     (type, "durationDays") happens in memory.

CREATE TYPE "ProductOfferType" AS ENUM (
    'ONE_TIME',
    'SUBSCRIPTION'
);

ALTER TABLE "Product"
ADD COLUMN "offerChangeTimestamps" TIMESTAMPTZ(6)[] NOT NULL DEFAULT '{}';

CREATE TABLE "ProductOffer" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "productId" UUID NOT NULL REFERENCES "Product" (id)
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    type "ProductOfferType" NOT NULL,
    "priceAmount" BIGINT NOT NULL,
    "durationDays" INTEGER,

    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),
    "createdById" UUID NOT NULL REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "updatedById" UUID REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "deletedById" UUID REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX "ProductOffer_productId_idx"
ON "ProductOffer" ("productId")
WHERE "deletedAt" IS NULL;
