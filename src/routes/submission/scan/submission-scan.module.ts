import { Module } from '@nestjs/common';
import { WorkflowValidationModule } from '../../workflow-validation/workflow-validation.module.ts';
import { SubmissionRepo } from '../submission.repo.ts';
import { SubmissionScanService } from './submission-scan.service.ts';
import { SubmissionScannerService } from './submission-scanner.service.ts';

// Deliberately separate from SubmissionModule so the queue slice does not depend on
// the HTTP slice, as spec section 9 requires. The module exports the scan service and
// knows nothing about the queue handler that drives it, which lives in src/consumer.
// SubmissionRepo only wraps PrismaService, so a second instance costs nothing.
@Module({
  imports: [WorkflowValidationModule],
  providers: [SubmissionScanService, SubmissionScannerService, SubmissionRepo],
  exports: [SubmissionScanService],
})
export class SubmissionScanModule {}
