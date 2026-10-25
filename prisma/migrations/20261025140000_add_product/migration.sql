-- Product module: Publisher-owned editable Marketplace aggregate for one Studio Project.
-- Spec: a2matex-docs/components/a2matex-backend/product_submission_release/product.md
--
-- Decisions encoded here:
--   * "currentReleaseId" is created now as a nullable column WITHOUT a foreign key.
--     The Product Release feature adds the constraint once "ProductRelease" exists.
--   * "Product"."projectId" is unique GLOBALLY, not partially. Soft deletion never
--     frees a Project for a second Product (spec section 3).
--   * "Product".slug is unique case-insensitively but only among live, named rows.

CREATE TYPE "ProductStatus" AS ENUM (
    'DRAFT',
    'ACTIVE',
    'SUSPENDED',
    'ARCHIVED'
);

CREATE TYPE "ProductMediaType" AS ENUM (
    'ICON',
    'COVER',
    'GALLERY'
);

-- Prerequisite for the composite foreign key below: Product ownership must never be
-- able to disagree with Project ownership, which needs this pair to be unique.
ALTER TABLE "Project"
    ADD CONSTRAINT "Project_id_publisherAccountId_key" UNIQUE (id, "publisherAccountId");

-- Prerequisite for ProductMedia: Static carries no ownership yet, so Product could not
-- tell an own image from another Publisher's. Nullable because legacy and system rows
-- keep no owner, and those rows stay ineligible for ProductMedia.
ALTER TABLE "Static"
    ADD COLUMN "publisherAccountId" UUID,
    ADD CONSTRAINT "Static_publisherAccountId_fkey"
        FOREIGN KEY ("publisherAccountId") REFERENCES "PublisherAccount" (id)
        ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE TABLE "Product" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "publisherAccountId" UUID NOT NULL REFERENCES "PublisherAccount" (id)
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    "projectId" UUID NOT NULL UNIQUE,
    status "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "currentReleaseId" UUID,
    name VARCHAR(255),
    slug VARCHAR(255),
    "shortDescription" VARCHAR(500),
    description TEXT,
    "usageInstructions" TEXT,
    "statusReason" TEXT,
    "suspendedAt" TIMESTAMPTZ(6),
    "suspendedById" UUID REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),
    "createdById" UUID NOT NULL REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "updatedById" UUID REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "deletedById" UUID REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,

    CONSTRAINT "Product_projectId_publisherAccountId_fkey"
        FOREIGN KEY ("projectId", "publisherAccountId")
        REFERENCES "Project" (id, "publisherAccountId")
        ON DELETE NO ACTION ON UPDATE NO ACTION,

    -- Both directions: a suspended Product must carry the full suspension record, and
    -- every other status must carry none of it.
    CONSTRAINT "Product_suspension_fields_check" CHECK (
        (
            status = 'SUSPENDED'
            AND "statusReason" IS NOT NULL
            AND "suspendedAt" IS NOT NULL
            AND "suspendedById" IS NOT NULL
        )
        OR (
            status <> 'SUSPENDED'
            AND "statusReason" IS NULL
            AND "suspendedAt" IS NULL
            AND "suspendedById" IS NULL
        )
    )
);

CREATE INDEX "Product_publisherAccountId_status_idx"
ON "Product" ("publisherAccountId", status)
WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "Product_slug_idx"
ON "Product" (lower(slug))
WHERE "deletedAt" IS NULL AND slug IS NOT NULL;

CREATE TABLE "ProductMedia" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "productId" UUID NOT NULL REFERENCES "Product" (id)
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    "staticId" UUID NOT NULL REFERENCES "Static" (id)
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    type "ProductMediaType" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "altText" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ProductMedia_sortOrder_check" CHECK ("sortOrder" >= 0)
);

CREATE UNIQUE INDEX "ProductMedia_product_static_idx"
ON "ProductMedia" ("productId", "staticId")
WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "ProductMedia_single_icon_idx"
ON "ProductMedia" ("productId")
WHERE "deletedAt" IS NULL AND type = 'ICON';

CREATE UNIQUE INDEX "ProductMedia_single_cover_idx"
ON "ProductMedia" ("productId")
WHERE "deletedAt" IS NULL AND type = 'COVER';
