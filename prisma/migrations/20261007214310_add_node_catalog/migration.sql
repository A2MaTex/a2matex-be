CREATE TYPE "NodeDefinitionStatus" AS ENUM (
    'ACTIVE',
    'DISABLED'
);

CREATE TABLE "Capability" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    "isSensitive" BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ
);

CREATE TABLE "NodeDefinition" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(100) NOT NULL,
    status "NodeDefinitionStatus" NOT NULL DEFAULT 'ACTIVE',
    "runtimeHandler" VARCHAR(255) NOT NULL,
    "minimumRuntimeVersion" VARCHAR(100) NOT NULL,
    "defaultTimeoutMs" INTEGER NOT NULL,
    "configSchema" JSONB NOT NULL,
    "inputSchema" JSONB NOT NULL,
    "outputSchema" JSONB NOT NULL,
    "outputPorts" JSONB NOT NULL,
    "editorHints" JSONB NOT NULL,
    "supportedErrorPolicies" JSONB NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "NodeDefinition_defaultTimeoutMs_check"
        CHECK ("defaultTimeoutMs" > 0),
    CONSTRAINT "NodeDefinition_contentHash_check"
        CHECK ("contentHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "NodeDefinition_json_objects_check" CHECK (
        jsonb_typeof("configSchema") = 'object'
        AND jsonb_typeof("inputSchema") = 'object'
        AND jsonb_typeof("outputSchema") = 'object'
        AND jsonb_typeof("outputPorts") = 'object'
        AND jsonb_typeof("editorHints") = 'object'
        AND jsonb_typeof("supportedErrorPolicies") = 'object'
    )
);

CREATE INDEX "NodeDefinition_status_type_idx"
ON "NodeDefinition" (status, type);

CREATE TABLE "NodeDefinitionCapability" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "nodeDefinitionId" UUID NOT NULL REFERENCES "NodeDefinition" (id),
    "capabilityId" UUID NOT NULL REFERENCES "Capability" (id),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "NodeDefinitionCapability_node_capability_key"
        UNIQUE ("nodeDefinitionId", "capabilityId")
);

CREATE INDEX "NodeDefinitionCapability_capabilityId_idx"
ON "NodeDefinitionCapability" ("capabilityId");
