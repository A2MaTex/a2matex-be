import { Module } from '@nestjs/common';
import { WorkflowCompilerRepo } from '../../workflow-compiler/workflow-compiler.repo.ts';
import { WorkflowCompilerService } from '../../workflow-compiler/workflow-compiler.service.ts';
import { WorkflowRevisionRepo } from '../../workflow-revision/workflow-revision.repo.ts';
import { SubmissionRepo } from '../submission.repo.ts';
import { SubmissionScanService } from './submission-scan.service.ts';
import { SubmissionScannerService } from './submission-scanner.service.ts';

// Deliberately separate from SubmissionModule so the queue slice does not depend on
// the HTTP slice, as spec section 9 requires. The module exports the scan service and
// knows nothing about the queue handler that drives it, which lives in src/consumer.
//
// The borrowed providers are declared rather than imported: each only wraps PrismaService, and
// WorkflowCompilerModule declares an HTTP controller that importing would register in the
// consumer process — exactly the coupling this module exists to avoid.
@Module({
  providers: [
    SubmissionScanService,
    SubmissionScannerService,
    SubmissionRepo,
    WorkflowRevisionRepo,
    WorkflowCompilerService,
    WorkflowCompilerRepo,
  ],
  exports: [SubmissionScanService],
})
export class SubmissionScanModule {}
