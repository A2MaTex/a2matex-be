-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('GOOGLE', 'GITHUB');

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;

-- CreateTable
CREATE TABLE "UserIdentity" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" "OAuthProvider" NOT NULL,
    "providerUserId" VARCHAR(255) NOT NULL,
    "userId" UUID NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6),

    CONSTRAINT "UserIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserIdentity_provider_providerUserId_idx" ON "UserIdentity"("provider", "providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "UserIdentity_userId_provider_idx" ON "UserIdentity"("userId", "provider");

-- AddForeignKey
ALTER TABLE "UserIdentity" ADD CONSTRAINT "UserIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

