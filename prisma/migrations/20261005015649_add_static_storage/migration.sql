-- CreateTable
CREATE TABLE "Static" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "objectKey" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "contentType" VARCHAR(255) NOT NULL,
    "size" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),
);

-- CreateIndex
CREATE UNIQUE INDEX "Static_objectKey_key" ON "Static"("objectKey");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_avatarStaticId_fkey" FOREIGN KEY ("avatarStaticId") REFERENCES "Static"("id");
