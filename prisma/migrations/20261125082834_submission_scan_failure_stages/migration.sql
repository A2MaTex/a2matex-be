-- Map existing FAILED scans to FAILED_VALIDATION during the enum conversion.
-- AlterEnum
BEGIN;
CREATE TYPE "SubmissionScanStatus_new" AS ENUM ('QUEUED', 'RUNNING', 'PASSED', 'ERROR', 'FAILED_VALIDATION', 'FAILED_COMPILATION');
ALTER TABLE "Submission" ALTER COLUMN "scanStatus" DROP DEFAULT;
ALTER TABLE "Submission" ALTER COLUMN "scanStatus" TYPE "SubmissionScanStatus_new"
USING (
    CASE "scanStatus"::text
        WHEN 'FAILED' THEN 'FAILED_VALIDATION'
        ELSE "scanStatus"::text
    END::"SubmissionScanStatus_new"
);
ALTER TYPE "SubmissionScanStatus" RENAME TO "SubmissionScanStatus_old";
ALTER TYPE "SubmissionScanStatus_new" RENAME TO "SubmissionScanStatus";
DROP TYPE "SubmissionScanStatus_old";
ALTER TABLE "Submission" ALTER COLUMN "scanStatus" SET DEFAULT 'QUEUED';
COMMIT;
