CREATE TYPE "PublisherAccountStatus" AS ENUM (
    'ACTIVE',
    'BLOCKED'
);

CREATE TYPE "TermType" AS ENUM (
    'PUBLISHER_TERMS',
    'CUSTOMER_TERMS',
    'PRIVACY_POLICY'
);

CREATE TYPE "TermStatus" AS ENUM (
    'DRAFT',
    'ACTIVE',
    'ARCHIVED'
);

CREATE TABLE "PublisherAccount" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL UNIQUE REFERENCES "User" (id),
    status "PublisherAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "activatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "blockedReason" TEXT,
    "blockedAt" TIMESTAMPTZ,
    "blockedById" UUID REFERENCES "User" (id),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ
);

CREATE TABLE "Term" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type "TermType" NOT NULL,
    version VARCHAR(100) NOT NULL,
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    status "TermStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMPTZ,
    "createdById" UUID NOT NULL REFERENCES "User" (id),
    "updatedById" UUID REFERENCES "User" (id),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "Term_type_version_key" UNIQUE (type, version)
);

CREATE UNIQUE INDEX "Term_one_active_type_idx"
ON "Term" (type)
WHERE status = 'ACTIVE' AND "deletedAt" IS NULL;

CREATE TABLE "PublisherTermsAcceptance" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "publisherAccountId" UUID NOT NULL REFERENCES "PublisherAccount" (id),
    "termId" UUID NOT NULL REFERENCES "Term" (id),
    "acceptedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "acceptanceMetadata" JSONB NOT NULL DEFAULT '{}'::JSONB,

    CONSTRAINT "PublisherTermsAcceptance_account_term_key"
        UNIQUE ("publisherAccountId", "termId")
);
