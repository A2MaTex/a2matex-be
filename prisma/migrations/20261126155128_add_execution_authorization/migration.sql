BEGIN;

CREATE TYPE "ExecutionAuthorizationOperation" AS ENUM (
    'START',
    'RENEW',
    'REAUTHORIZE'
);

CREATE TYPE "ExecutionAuthorizationRequestState" AS ENUM (
    'RESERVED',
    'COMMITTED'
);

CREATE TABLE "ExecutionLease" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "executionId" UUID NOT NULL UNIQUE,
    "userId" UUID NOT NULL REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "productId" UUID NOT NULL REFERENCES "Product" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "entitlementId" UUID NOT NULL REFERENCES "Entitlement" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "productReleaseId" UUID NOT NULL REFERENCES "ProductRelease" (id)
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    "packageHash" VARCHAR(64) NOT NULL,
    "runtimeSessionId" UUID NOT NULL,
    "runtimeKeyThumbprint" VARCHAR(64) NOT NULL,
    "currentLeaseId" UUID NOT NULL UNIQUE,
    sequence INTEGER NOT NULL DEFAULT 1 CHECK (sequence > 0),
    "signingKeyId" VARCHAR(64) NOT NULL,
    "issuedAt" TIMESTAMPTZ(6) NOT NULL,
    "refreshAfter" TIMESTAMPTZ(6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ExecutionLease_period_check" CHECK (
        "issuedAt" < "refreshAfter" AND "refreshAfter" < "expiresAt"
    )
);

CREATE TABLE "ExecutionAuthorizationRequest" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "requestId" UUID NOT NULL,
    operation "ExecutionAuthorizationOperation" NOT NULL,
    "requestFingerprint" VARCHAR(64) NOT NULL,
    state "ExecutionAuthorizationRequestState" NOT NULL DEFAULT 'RESERVED',
    "ownerToken" UUID,
    "reservedUntil" TIMESTAMPTZ(6),
    "leaseFamilyId" UUID REFERENCES "ExecutionLease" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "leaseId" UUID,
    "retainUntil" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ExecutionAuthorizationRequest_user_request_key"
        UNIQUE ("userId", "requestId"),
    CONSTRAINT "ExecutionAuthorizationRequest_state_check" CHECK (
        (state = 'RESERVED' AND "ownerToken" IS NOT NULL AND "reservedUntil" IS NOT NULL
            AND "leaseFamilyId" IS NULL AND "leaseId" IS NULL)
        OR
        (state = 'COMMITTED' AND "ownerToken" IS NULL AND "reservedUntil" IS NULL
            AND "leaseFamilyId" IS NOT NULL AND "leaseId" IS NOT NULL)
    )
);

CREATE INDEX "ExecutionAuthorizationRequest_retainUntil_idx"
ON "ExecutionAuthorizationRequest" ("retainUntil");

COMMIT;
