-- CreateEnum
CREATE TYPE "StaticImageVariantType" AS ENUM ('SMALL', 'MEDIUM');

-- CreateTable
CREATE TABLE "StaticImageVariant" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "staticId" UUID NOT NULL,
    "variant" "StaticImageVariantType" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" VARCHAR(255) NOT NULL,
    "size" BIGINT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaticImageVariant_size_check" CHECK ("size" >= 0),
    CONSTRAINT "StaticImageVariant_dimensions_check" CHECK ("width" > 0 AND "height" > 0),
    CONSTRAINT "StaticImageVariant_staticId_fkey" FOREIGN KEY ("staticId") REFERENCES "Static"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateIndex
CREATE UNIQUE INDEX "StaticImageVariant_staticId_variant_key"
ON "StaticImageVariant"("staticId", "variant");

-- CreateIndex
CREATE UNIQUE INDEX "StaticImageVariant_objectKey_key"
ON "StaticImageVariant"("objectKey");
