-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('UPLOADING', 'COMPLETED', 'ABORTED');

-- CreateTable
CREATE TABLE "StaticUploadSession" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "file_hash" TEXT NOT NULL,
    "upload_id" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "status" "SessionStatus",
    "expires_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6),
    "deleted_at" TIMESTAMP(6),
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_by" UUID,

    CONSTRAINT "StaticUploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_StaticUploadSession_file_hash" ON "StaticUploadSession"("file_hash") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "idx_unique_uploading_session"
ON "StaticUploadSession"("file_hash")
WHERE (status = 'UPLOADING'::"SessionStatus");

-- AddForeignKey
ALTER TABLE "StaticUploadSession" ADD CONSTRAINT "StaticUploadSession_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaticUploadSession" ADD CONSTRAINT "StaticUploadSession_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaticUploadSession" ADD CONSTRAINT "StaticUploadSession_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
