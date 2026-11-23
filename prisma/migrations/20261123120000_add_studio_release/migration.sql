-- CreateTable
CREATE TABLE "StudioRelease" (
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

-- CreateIndex
CREATE UNIQUE INDEX "StudioRelease_version_key" ON "StudioRelease"("version");

-- CreateIndex
-- Bất biến "nhiều nhất một bản hiệu lực" được DB giữ, không chỉ khoá phân tán.
CREATE UNIQUE INDEX "StudioRelease_isActive_idx" ON "StudioRelease"("isActive") WHERE ("isActive" AND "deletedAt" IS NULL);
