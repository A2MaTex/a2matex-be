import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SUBMISSION_SCANNER_VERSION,
  SubmissionScanStatus,
} from '../../../shared/constants/submission.constant.ts';
import { Transactional } from '../../../shared/decorators/transactional.decorator.ts';
import { TransactionService } from '../../../shared/services/transaction.service.ts';
import { WorkflowRevisionRepo } from '../../workflow-revision/workflow-revision.repo.ts';
import { SubmissionRepo } from '../submission.repo.ts';
import { SubmissionScannerService } from './submission-scanner.service.ts';
import type { SubmissionScanOutcome } from './submission-scanner.service.ts';

// How a scan request ended, decided from database state rather than from how many
// times the request was delivered.
export const ScanOutcome = {
  COMPLETED: 'COMPLETED',
  ALREADY_DONE: 'ALREADY_DONE',
  STALE: 'STALE',
  INVALID: 'INVALID',
} as const;

export type ScanOutcomeType = (typeof ScanOutcome)[keyof typeof ScanOutcome];

@Injectable()
export class SubmissionScanService {
  private readonly logger = new Logger(SubmissionScanService.name);

  constructor(
    @Inject(SubmissionRepo) private readonly submissionRepo: SubmissionRepo,
    @Inject(SubmissionScannerService) private readonly scanner: SubmissionScannerService,
    @Inject(WorkflowRevisionRepo) private readonly workflowRevisionRepo: WorkflowRevisionRepo,
    @Inject(TransactionService) readonly transactionService: TransactionService,
  ) {}

  async run({
    submissionId,
    scanAttempt,
  }: {
    submissionId: string;
    scanAttempt: number;
  }): Promise<ScanOutcomeType> {
    const target = await this.submissionRepo.loadForScan(submissionId);
    // A request naming a Submission that does not exist can never succeed.
    if (!target) {
      return ScanOutcome.INVALID;
    }
    // An attempt ahead of the record is impossible: only the retry route moves the
    // counter, and it commits before publishing.
    if (scanAttempt > target.scanAttempt) {
      return ScanOutcome.INVALID;
    }
    // An older attempt was superseded by a retry; its work is no longer wanted.
    if (scanAttempt < target.scanAttempt) {
      return ScanOutcome.STALE;
    }
    if (
      target.scanStatus === SubmissionScanStatus.PASSED ||
      target.scanStatus === SubmissionScanStatus.FAILED
    ) {
      return ScanOutcome.ALREADY_DONE;
    }

    const claimed = await this.submissionRepo.claimScan({ submissionId, scanAttempt });
    // Another attempt claimed it between the load and here, or the retry route moved
    // the counter. Either way this attempt has nothing left to do.
    if (!claimed) {
      return ScanOutcome.ALREADY_DONE;
    }

    // Outside any transaction: this reads immutable content and writes nothing.
    const { result: scanResult, compilation } = this.scanner.scan(target);
    const scanStatus =
      scanResult.summary.errors > 0 ? SubmissionScanStatus.FAILED : SubmissionScanStatus.PASSED;

    const persisted = await this.persistOutcome({
      submissionId,
      scanAttempt,
      scanStatus,
      scanResult,
      scannerVersion: SUBMISSION_SCANNER_VERSION,
      workflowRevisionId: target.WorkflowRevision.id,
      compilation,
    });

    // A retry can move the counter mid-compile, in which case nothing was written.
    if (!persisted.applied) {
      this.logger.log(
        `Submission scan superseded submissionId=${submissionId} scanAttempt=${scanAttempt}`,
      );
      return ScanOutcome.STALE;
    }

    this.logger.log(
      `Submission scan completed submissionId=${submissionId} scanAttempt=${scanAttempt} ` +
        `scanStatus=${scanStatus} errors=${scanResult.summary.errors} ` +
        `warnings=${scanResult.summary.warnings} ` +
        `revisionFinalized=${persisted.finalized}`,
    );
    return ScanOutcome.COMPLETED;
  }

  // Result, status and compiled Runtime IR commit together. Split across transactions, a
  // crash between them leaves a passed scan stuck in PENDING_SCAN — a later attempt sees a
  // terminal scan and stops — or an authoritative Runtime IR with no result explaining it.
  @Transactional()
  private async persistOutcome({
    workflowRevisionId,
    compilation,
    ...outcome
  }: Parameters<SubmissionRepo['persistScanOutcome']>[0] & {
    workflowRevisionId: string;
    compilation: SubmissionScanOutcome['compilation'];
  }): Promise<{ applied: boolean; finalized: boolean }> {
    const applied = await this.submissionRepo.persistScanOutcome(outcome);
    // A superseded attempt writes nothing at all, the revision included.
    if (!applied || !compilation) {
      return { applied, finalized: false };
    }
    // Null-to-value: a concurrent delivery writing first is success, not conflict.
    await this.workflowRevisionRepo.finalizeCompilation({
      workflowRevisionId,
      runtimeIr: compilation.runtimeIr,
      contentHash: compilation.contentHash,
    });
    return { applied, finalized: true };
  }

  // Best effort: a scan that failed for infrastructure reasons should say so, but if
  // the database is the thing that is down this write fails too and the caller still
  // retries.
  async markTechnicalFailure(input: { submissionId: string; scanAttempt: number }): Promise<void> {
    try {
      await this.submissionRepo.recordScanError(input);
    } catch (error) {
      this.logger.error(
        `Could not record scan error submissionId=${input.submissionId} ` +
          `scanAttempt=${input.scanAttempt}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}
