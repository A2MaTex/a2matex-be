-- CreateEnum
CREATE TYPE "TopUpTransactionStatus" AS ENUM ('PENDING', 'CREDITED', 'UNMATCHED');

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "balance" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TopUpTransaction" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID,
    "referenceCode" TEXT,
    "requestedAmount" BIGINT,
    "receivedAmount" BIGINT,
    "providerTransactionId" TEXT,
    "rawContent" TEXT,
    "status" "TopUpTransactionStatus" NOT NULL,
    "creditedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6),

    CONSTRAINT "TopUpTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TopUpTransaction_referenceCode_idx" ON "TopUpTransaction"("referenceCode");

-- CreateIndex
CREATE UNIQUE INDEX "TopUpTransaction_providerTransactionId_idx" ON "TopUpTransaction"("providerTransactionId");
