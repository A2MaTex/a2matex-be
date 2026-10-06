-- CreateTable
CREATE TABLE "LauncherRelease" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "version" VARCHAR(100) NOT NULL,
    "staticId" UUID NOT NULL REFERENCES "Static"("id"),
    "releaseNotes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6)
);
