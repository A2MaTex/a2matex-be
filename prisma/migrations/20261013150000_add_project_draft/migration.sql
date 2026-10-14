CREATE UNIQUE INDEX "Project_publisherAccountId_name_ci_key"
ON "Project" ("publisherAccountId", lower(btrim(name)));

CREATE TABLE "ProjectDraft" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "projectId" UUID NOT NULL UNIQUE REFERENCES "Project" (id) ON DELETE NO ACTION,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    "editorGraph" JSONB NOT NULL,
    "inputSchema" JSONB NOT NULL,
    "runtimeIr" JSONB,
    "validationSummary" JSONB NOT NULL DEFAULT '{}'::JSONB,
    "testSummary" JSONB NOT NULL DEFAULT '{}'::JSONB,
    "contentHash" VARCHAR(64) NOT NULL,
    "savedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "savedById" UUID NOT NULL REFERENCES "User" (id) ON DELETE NO ACTION,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ProjectDraft_contentHash_check"
        CHECK ("contentHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ProjectDraft_json_objects_check" CHECK (
        jsonb_typeof("editorGraph") = 'object'
        AND jsonb_typeof("inputSchema") = 'object'
        AND ("runtimeIr" IS NULL OR jsonb_typeof("runtimeIr") = 'object')
        AND jsonb_typeof("validationSummary") = 'object'
        AND jsonb_typeof("testSummary") = 'object'
    )
);
