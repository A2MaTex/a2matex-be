CREATE TABLE "WorkflowRevision" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "projectId" UUID NOT NULL REFERENCES "Project" (id),
    "sourceDraftVersion" INTEGER NOT NULL,
    "sourceDraftContentHash" VARCHAR(64) NOT NULL,
    "editorGraph" JSONB NOT NULL,
    "runtimeIr" JSONB NOT NULL,
    "inputSchema" JSONB NOT NULL,
    "nodeDefinitionManifest" JSONB NOT NULL,
    "capabilityManifest" JSONB NOT NULL,
    "validationSummary" JSONB NOT NULL,
    "testSummary" JSONB NOT NULL DEFAULT '{}'::JSONB,
    "contentHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),
    "createdById" UUID NOT NULL REFERENCES "User" (id),
    "updatedById" UUID REFERENCES "User" (id),
    "deletedById" UUID REFERENCES "User" (id),

    CONSTRAINT "WorkflowRevision_sourceDraftVersion_check"
        CHECK ("sourceDraftVersion" > 0),
    CONSTRAINT "WorkflowRevision_sourceDraftContentHash_check"
        CHECK ("sourceDraftContentHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "WorkflowRevision_contentHash_check"
        CHECK ("contentHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "WorkflowRevision_json_objects_check" CHECK (
        jsonb_typeof("editorGraph") = 'object'
        AND jsonb_typeof("runtimeIr") = 'object'
        AND jsonb_typeof("inputSchema") = 'object'
        AND jsonb_typeof("nodeDefinitionManifest") = 'object'
        AND jsonb_typeof("capabilityManifest") = 'object'
        AND jsonb_typeof("validationSummary") = 'object'
        AND jsonb_typeof("testSummary") = 'object'
    ),
    CONSTRAINT "WorkflowRevision_project_draftVersion_key"
        UNIQUE ("projectId", "sourceDraftVersion")
);
