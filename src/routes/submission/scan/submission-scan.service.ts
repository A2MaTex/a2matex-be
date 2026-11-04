import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SUBMISSION_SCANNER_VERSION,
  SubmissionScanStatus,
} from '../../../shared/constants/submission.constant.ts';
import { Transactional } from '../../../shared/decorators/transactional.decorator.ts';
import { TransactionService } from '../../../shared/services/transaction.service.ts';
import { SubmissionRepo } from '../submission.repo.ts';
import { SubmissionScannerService } from './submission-scanner.service.ts';

// What the consumer should tell the queue, decided from database state rather than
// from how many times the message has been delivered.
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
    // A message naming a Submission that does not exist can never succeed.
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
    // Another delivery claimed it between the load and here, or the retry route moved
    // the counter. Either way this delivery has nothing left to do.
    if (!claimed) {
      return ScanOutcome.ALREADY_DONE;
    }

    // Rules run outside any transaction: they read immutable content and touch nothing.
    const scanResult = await this.scanner.scan(target);
    const scanStatus =
      scanResult.summary.errors > 0 ? SubmissionScanStatus.FAILED : SubmissionScanStatus.PASSED;

    await this.persistOutcome({
      submissionId,
      scanAttempt,
      scanStatus,
      scanResult,
      scannerVersion: SUBMISSION_SCANNER_VERSION,
    });

    this.logger.log(
      `Submission scan completed submissionId=${submissionId} scanAttempt=${scanAttempt} ` +
        `scanStatus=${scanStatus} errors=${scanResult.summary.errors} ` +
        `warnings=${scanResult.summary.warnings}`,
    );
    return ScanOutcome.COMPLETED;
  }

  // The result and the status move commit together. Split across two transactions, a
  // crash between them leaves a passed scan on a Submission still marked PENDING_SCAN:
  // redelivery then sees a terminal scan and stops, so the status would never move.
  @Transactional()
  private persistOutcome(input: Parameters<SubmissionRepo['persistScanOutcome']>[0]) {
    return this.submissionRepo.persistScanOutcome(input);
  }

  // Best effort: a scan that failed for infrastructure reasons should say so, but if
  // the database is the thing that is down this write fails too and the delivery still
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
