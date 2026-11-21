-- Entitlement: a customer's durable right to use one Product.
-- Spec: specs/006-entitlement (spec.md, data-model.md, research.md).
--
-- Decisions encoded here:
--   * One row per (customer, Product). Purchases and Admin grants update it; no row per
--     period.
--   * Stored status is ACTIVE or REVOKED only. EXPIRED is derived from "expiresAt" against
--     now() when read, so no job has to flip it and a stale row can never grant access.
--   * Revoke fields are all set exactly when status is REVOKED (both directions). An Admin
--     grant clears them; the history survives in "auditHistory", which only ever grows.
--   * "grantedById" is set exactly when the latest source is an Admin grant.
--   * "latestOrderItemId" has no foreign key yet: OrderItem arrives with the Order spec,
--     whose migration adds the constraint.

CREATE TYPE "EntitlementStatus" AS ENUM (
    'ACTIVE',
    'REVOKED'
);

CREATE TYPE "EntitlementGrantSource" AS ENUM (
    'ORDER',
    'ADMIN_GRANT'
);

CREATE TABLE "Entitlement" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "customerId" UUID NOT NULL REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "productId" UUID NOT NULL REFERENCES "Product" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    status "EntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
    "grantSource" "EntitlementGrantSource" NOT NULL,
    "grantedById" UUID REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6),
    "latestProductOfferId" UUID REFERENCES "ProductOffer" (id)
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    "latestOrderItemId" UUID,
    "oneTimePurchasedAt" TIMESTAMPTZ(6),
    "grantSnapshot" JSONB NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "revokedById" UUID REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "revokedReason" TEXT,
    "auditHistory" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Entitlement_period_check"
        CHECK ("expiresAt" IS NULL OR "expiresAt" > "startsAt"),
    CONSTRAINT "Entitlement_revoke_fields_check" CHECK (
        (
            status = 'REVOKED'
            AND "revokedAt" IS NOT NULL
            AND "revokedById" IS NOT NULL
            AND "revokedReason" IS NOT NULL
        )
        OR (
            status <> 'REVOKED'
            AND "revokedAt" IS NULL
            AND "revokedById" IS NULL
            AND "revokedReason" IS NULL
        )
    ),
    CONSTRAINT "Entitlement_granted_by_check"
        CHECK (("grantSource" = 'ADMIN_GRANT') = ("grantedById" IS NOT NULL)),
    CONSTRAINT "Entitlement_grantSnapshot_object_check"
        CHECK (jsonb_typeof("grantSnapshot") = 'object'),
    CONSTRAINT "Entitlement_auditHistory_array_check"
        CHECK (jsonb_typeof("auditHistory") = 'array')
);

-- Also serves My Products and the Admin customer filter through its leading column.
CREATE UNIQUE INDEX "Entitlement_customerId_productId_key"
ON "Entitlement" ("customerId", "productId");

CREATE INDEX "Entitlement_productId_idx"
ON "Entitlement" ("productId");
