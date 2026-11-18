-- CreateEnum
CREATE TYPE "ProductReleaseStatus" AS ENUM ('BUILDING', 'PUBLISHED', 'BUILD_FAILED', 'DISABLED');

-- CreateTable
CREATE TABLE "ProductRelease" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "version" VARCHAR(100) NOT NULL,
    "status" "ProductReleaseStatus" NOT NULL DEFAULT 'BUILDING',
    "packageStaticId" UUID,
    "packageHash" VARCHAR(64),
    "wrappedKey" BYTEA,
    "nonce" BYTEA,
    "contentKeyNonce" BYTEA,
    "algorithm" VARCHAR(32),
    "buildFailureCode" VARCHAR(100),
    "publishedAt" TIMESTAMPTZ(6),
    "disabledAt" TIMESTAMPTZ(6),
    "disabledReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6),
    "createdById" UUID NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "ProductRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductRelease_submissionId_key" ON "ProductRelease"("submissionId");

-- CreateIndex
CREATE INDEX "ProductRelease_productId_publishedAt_id_idx" ON "ProductRelease"("productId", "publishedAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ProductRelease_productId_version_key" ON "ProductRelease"("productId", "version");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_currentReleaseId_fkey" FOREIGN KEY ("currentReleaseId") REFERENCES "ProductRelease"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRelease" ADD CONSTRAINT "ProductRelease_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRelease" ADD CONSTRAINT "ProductRelease_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
