import { Module } from '@nestjs/common';
import { WorkflowValidationModule } from '../../workflow-validation/workflow-validation.module.ts';
import { SubmissionRepo } from '../submission.repo.ts';
import { SubmissionScanConsumer } from './submission-scan.consumer.ts';
import { SubmissionScanService } from './submission-scan.service.ts';
import { SubmissionScannerService } from './submission-scanner.service.ts';

// Deliberately separate from SubmissionModule so the queue slice does not depend on
// the HTTP slice, as spec section 9 requires. Controllers reached this way are inert
// under createApplicationContext — WorkflowValidationModule declares one and the
// consumer boots fine — so this is about coupling, not about avoiding a crash.
// SubmissionRepo only wraps PrismaService, so a second instance costs nothing.
@Module({
  imports: [WorkflowValidationModule],
  providers: [
    SubmissionScanConsumer,
    SubmissionScanService,
    SubmissionScannerService,
    SubmissionRepo,
  ],
  exports: [SubmissionScanConsumer],
})
export class SubmissionScanModule {}
