-- Submission module: immutable review request freezing one Product + WorkflowRevision pair.
-- Spec: a2matex-docs/components/a2matex-backend/product_submission_release/submission.md
--
-- Decisions encoded here:
--   * One table only. The older db_design/03 notes describe "SubmissionScan" and
--     "SubmissionReview" tables plus "previousSubmissionId"/"submittedAt"; submission.md
--     supersedes them. Scan and review live in JSONB columns on this row, and the
--     preceding submission is the same "productId" with number - 1.
--   * Review columns are created now but stay unwritten until the Review module exists.
--   * The database enforces identity and concurrent-create idempotency only. Scan and
--     review transitions, JSON shapes, positive counters, timestamp pairing and
--     soft-delete pairing are Backend rules (spec section 4.1), so no CHECK is added.

CREATE TYPE "SubmissionStatus" AS ENUM (
    'PENDING_SCAN',
    'READY_FOR_REVIEW',
    'CHANGES_REQUESTED',
    'APPROVED',
    'REJECTED'
);

CREATE TYPE "SubmissionScanStatus" AS ENUM (
    'QUEUED',
    'RUNNING',
    'PASSED',
    'FAILED',
    'ERROR'
);

CREATE TABLE "Submission" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "productId" UUID NOT NULL REFERENCES "Product" (id)
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    "workflowRevisionId" UUID NOT NULL UNIQUE REFERENCES "WorkflowRevision" (id)
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    number INTEGER NOT NULL,
    status "SubmissionStatus" NOT NULL DEFAULT 'PENDING_SCAN',
    "productSnapshot" JSONB NOT NULL,
    "releaseRequest" JSONB NOT NULL,
    "reviewContext" JSONB NOT NULL,

    -- Detects an Idempotency-Key replayed with a different normalized body. Not the
    -- WorkflowRevision content hash.
    "idempotencyKey" VARCHAR(255) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,

    -- Current automated scan only. Technical retry history stays in structured logs.
    "scanAttempt" INTEGER NOT NULL DEFAULT 1,
    "scanStatus" "SubmissionScanStatus" NOT NULL DEFAULT 'QUEUED',
    "scannerVersion" VARCHAR(100),
    "scanResult" JSONB,

    -- Reserved for the Review module.
    "reviewedAt" TIMESTAMPTZ(6),
    "reviewFeedback" JSONB,

    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),
    "createdById" UUID NOT NULL REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "updatedById" UUID REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    "deletedById" UUID REFERENCES "User" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,

    CONSTRAINT "Submission_productId_number_key" UNIQUE ("productId", number),
    CONSTRAINT "Submission_createdById_idempotencyKey_key"
        UNIQUE ("createdById", "idempotencyKey")
);

-- Admin review queue. The UNIQUE above already serves per-Product submission history in
-- both directions, so no second Product/number index is added.
CREATE INDEX "Submission_status_createdAt_idx"
ON "Submission" (status, "createdAt" DESC);
