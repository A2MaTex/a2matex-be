-- A Workflow Revision now freezes only publisher-authored source at submit time.
-- The Submission scan consumer compiles the frozen source and writes these two
-- server-derived columns exactly once, so both start null.
ALTER TABLE "WorkflowRevision"
    ALTER COLUMN "runtimeIr" DROP NOT NULL,
    ALTER COLUMN "contentHash" DROP NOT NULL;
