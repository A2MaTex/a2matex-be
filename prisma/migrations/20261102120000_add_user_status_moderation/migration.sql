ALTER TABLE "User"
ADD COLUMN "previousStatus" "UserStatus",
ADD COLUMN "statusReason" TEXT,
ADD COLUMN "statusChangedAt" TIMESTAMPTZ(6),
ADD COLUMN "statusChangedById" UUID;

ALTER TABLE "User"
ADD CONSTRAINT "User_statusChangedById_fkey"
FOREIGN KEY ("statusChangedById") REFERENCES "User"("id")
ON DELETE NO ACTION ON UPDATE NO ACTION;
