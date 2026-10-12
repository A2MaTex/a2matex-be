CREATE TYPE "ProjectStatus" AS ENUM (
    'ACTIVE',
    'ARCHIVED'
);

CREATE TABLE "Project" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "publisherAccountId" UUID NOT NULL REFERENCES "PublisherAccount" (id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),
    "createdById" UUID NOT NULL REFERENCES "User" (id),
    "updatedById" UUID REFERENCES "User" (id),
    "deletedById" UUID REFERENCES "User" (id)
);

CREATE INDEX "Project_publisherAccountId_status_idx"
ON "Project" ("publisherAccountId", status)
WHERE "deletedAt" IS NULL;