-- AlterTable
ALTER TABLE "StaticUploadSession" ADD COLUMN     "content_type" TEXT NOT NULL,
ADD COLUMN     "original_name" TEXT NOT NULL,
ADD COLUMN     "size" BIGINT NOT NULL;
