import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { KAFKA_TOPICS } from '../../shared/constants/kafka.constant.ts';
import { RELEASABLE_PRODUCT_STATUSES } from '../../shared/constants/product.constant.ts';
import { PublisherAccountStatus } from '../../shared/constants/publisher.constant.ts';
import {
  SubmissionScanStatus,
  SubmissionStatus,
} from '../../shared/constants/submission.constant.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import {
  QUEUE_PROVIDER,
  type MessageProvider,
} from '../../shared/infrastructure/queue/queue.interface.ts';
import { SUCCESS_RESPONSE } from '../../shared/models/response.model.ts';
import type { MessageResType } from '../../shared/models/response.model.ts';
import { EmailService } from '../../shared/services/email.service.tsx';
import { RequestLogContextService } from '../../shared/infrastructure/logging/request-log-context.service.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import { isTransactionTimeoutPrismaError } from '../../shared/utils/prisma.ts';
import {
  SubmissionAccessDeniedException,
  SubmissionNotFoundException,
} from '../submission/submission.error.ts';
import {
  DECISION_STATUS,
  PRODUCT_RELEASE_BUILD_MESSAGE_ID_PREFIX,
  PRODUCT_RELEASE_BUILD_MESSAGE_TYPE,
  SUBMISSION_REVIEW_EMAIL_COPY,
  SUBMISSION_REVIEW_EMAIL_TIMEOUT_MS,
  SUBMISSION_REVIEW_TX_MAX_WAIT_MS,
  SUBMISSION_REVIEW_TX_TIMEOUT_MS,
  SubmissionReviewDecision,
  TERMINAL_REVIEW_STATUSES,
  type SubmissionReviewDecisionType,
} from './submission-review.constant.ts';
import {
  ProductReleaseBuildPublishFailedException,
  SubmissionAlreadyReviewedException,
  SubmissionNotEligibleForApprovalException,
  SubmissionNotReadyForReviewException,
  SubmissionReviewConflictException,
  SubmissionReviewStateInvalidException,
  SubmissionReviewTimeoutException,
  SubmissionScanFailedException,
  SubmissionScanIncompleteException,
  SubmissionSelfReviewForbiddenException,
} from './submission-review.error.ts';
import { canonicalFeedbackHash, storedFeedbackHash } from './submission-review.model.ts';
import type { ReviewSubmissionInputType } from './submission-review.model.ts';
import {
  SubmissionReviewRepo,
  type ApprovalEligibility,
  type SubmissionReviewIdentity,
  type SubmissionReviewTarget,
} from './submission-review.repo.ts';

@Injectable()
export class SubmissionReviewService {
  private readonly logger = new Logger(SubmissionReviewService.name);

  constructor(
    @Inject(SubmissionReviewRepo) private readonly submissionReviewRepo: SubmissionReviewRepo,
    @Inject(QUEUE_PROVIDER) private readonly queue: MessageProvider,
    @Inject(EmailService) private readonly emailService: EmailService,
    @Inject(RequestLogContextService) private readonly requestLogContext: RequestLogContextService,
    @Inject(TransactionService) readonly transactionService: TransactionService,
  ) {}

  async decide({
    submissionId,
    data,
    userId,
    scopes,
  }: {
    submissionId: string;
    data: ReviewSubmissionInputType;
    userId: string;
    scopes: ActivePermissionScope[];
  }): Promise<MessageResType> {
    if (!scopes.includes(null)) {
      throw SubmissionAccessDeniedException;
    }

    const identity = await this.submissionReviewRepo.getIdentity(submissionId);
    if (!identity) {
      throw SubmissionNotFoundException;
    }
    if (identity.createdById === userId) {
      throw SubmissionSelfReviewForbiddenException;
    }

    try {
      await this.commitDecision({ identity, data, userId });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (isTransactionTimeoutPrismaError(error)) {
        this.logger.error(
          `Submission review transaction timed out submissionId=${identity.id} ` +
            `productId=${identity.productId} decision=${data.decision}`,
        );
        throw SubmissionReviewTimeoutException;
      }
      throw error;
    }
    return SUCCESS_RESPONSE;
  }

  @Transactional({
    timeout: SUBMISSION_REVIEW_TX_TIMEOUT_MS,
    maxWait: SUBMISSION_REVIEW_TX_MAX_WAIT_MS,
  })
  private async commitDecision({
    identity,
    data,
    userId,
  }: {
    identity: SubmissionReviewIdentity;
    data: ReviewSubmissionInputType;
    userId: string;
  }): Promise<void> {
    const approving = data.decision === SubmissionReviewDecision.APPROVE;
    // Product before Submission, as the create path does. A replay skips the lock.
    const eligibility =
      approving && !TERMINAL_REVIEW_STATUSES.includes(identity.status)
        ? await this.submissionReviewRepo.lockProductForApproval(identity.productId)
        : null;

    const target = await this.submissionReviewRepo.lockSubmissionForReview(identity.id);
    if (!target) {
      throw SubmissionNotFoundException;
    }

    if (TERMINAL_REVIEW_STATUSES.includes(target.status)) {
      this.assertIdenticalReplay(target, data);
      // Republishing is the documented recovery for a lost publication.
      if (approving) {
        if (!target.reviewedAt) {
          this.logger.error(
            `Terminal Submission has no reviewedAt submissionId=${identity.id} ` +
              `status=${target.status}`,
          );
          throw SubmissionReviewStateInvalidException;
        }
        await this.publishAfterCommit({ identity, occurredAt: target.reviewedAt });
      }
      return;
    }
    if (target.status !== SubmissionStatus.READY_FOR_REVIEW) {
      throw SubmissionNotReadyForReviewException;
    }

    assertScanEligible(target, data.decision);
    if (approving) {
      assertApprovalEligible(eligibility);
    }

    const reviewedAt = new Date();
    const updated = await this.submissionReviewRepo.applyDecision({
      submissionId: identity.id,
      status: DECISION_STATUS[data.decision],
      reviewedAt,
      feedback: data.feedback ?? null,
      userId,
    });
    if (updated === 0) {
      throw SubmissionNotReadyForReviewException;
    }

    // Before the publication: callbacks run in order and a publish failure stops them.
    await this.transactionService.afterCommit(() =>
      this.notifyPublisher({ submissionId: identity.id, decision: data.decision }),
    );

    if (approving) {
      await this.publishAfterCommit({ identity, occurredAt: reviewedAt });
    }
  }

  // Best effort: a provider outage must not turn a committed decision into an error.
  private async notifyPublisher({
    submissionId,
    decision,
  }: {
    submissionId: string;
    decision: SubmissionReviewDecisionType;
  }): Promise<void> {
    try {
      const target = await this.submissionReviewRepo.getNotificationTarget(submissionId);
      if (!target) {
        this.logger.warn(`No notification target for reviewed Submission ${submissionId}`);
        return;
      }

      const copy = SUBMISSION_REVIEW_EMAIL_COPY[decision];
      const { error } = await withTimeout(
        this.emailService.sendSubmissionReviewResult({
          email: target.email,
          subject: copy.subject,
          nextStep: copy.nextStep,
          productName: target.productName ?? 'sản phẩm của bạn',
          submissionNumber: target.submissionNumber,
        }),
        SUBMISSION_REVIEW_EMAIL_TIMEOUT_MS,
      );
      if (error) {
        this.logger.error(
          `Review notification rejected submissionId=${submissionId} decision=${decision}: ` +
            `${error.message}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Review notification failed submissionId=${submissionId} decision=${decision}: ` +
          `${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  private assertIdenticalReplay(
    target: SubmissionReviewTarget,
    data: ReviewSubmissionInputType,
  ): void {
    if (target.status !== DECISION_STATUS[data.decision]) {
      throw SubmissionAlreadyReviewedException;
    }
    if (storedFeedbackHash(target.reviewFeedback) !== canonicalFeedbackHash(data.feedback)) {
      throw SubmissionReviewConflictException;
    }
  }

  // A network call must never run while the transaction holds row locks.
  private publishAfterCommit({
    identity,
    occurredAt,
  }: {
    identity: SubmissionReviewIdentity;
    occurredAt: Date;
  }): Promise<void> {
    return this.transactionService.afterCommit(() =>
      this.publishBuildRequest({
        submissionId: identity.id,
        productId: identity.productId,
        occurredAt,
      }),
    );
  }

  // Identifiers only. `occurredAt` is the stored review time so a republish is identical.
  private async publishBuildRequest({
    submissionId,
    productId,
    occurredAt,
  }: {
    submissionId: string;
    productId: string;
    occurredAt: Date;
  }): Promise<void> {
    const messageId = `${PRODUCT_RELEASE_BUILD_MESSAGE_ID_PREFIX}:${submissionId}`;
    // Same correlation contract as the scan request: the reviewer's request trace travels
    // with the build message so a build failure points back at the approval.
    const traceId = this.requestLogContext.current?.traceId;
    try {
      await this.queue.publish({
        topic: KAFKA_TOPICS.PRODUCT_RELEASE_BUILD_REQUESTED,
        key: productId,
        message: {
          id: messageId,
          type: PRODUCT_RELEASE_BUILD_MESSAGE_TYPE,
          occurredAt: occurredAt.toISOString(),
          ...(traceId ? { traceId } : {}),
          payload: { submissionId },
        },
      });
    } catch (error) {
      this.logger.error(
        `Product Release build publication failed submissionId=${submissionId} ` +
          `productId=${productId} messageId=${messageId}: ` +
          `${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw ProductReleaseBuildPublishFailedException;
    }
  }
}

// `decide` waits on the after-commit callbacks and the mail client sets no deadline.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

function assertScanEligible(
  target: SubmissionReviewTarget,
  decision: SubmissionReviewDecisionType,
): void {
  if (target.scanStatus === SubmissionScanStatus.PASSED) {
    // A passed scan finalizes the revision in the same transaction, so a passed scan without
    // one means the row predates that rule or was altered. Approval must not hand Product
    // Release a build source it would have to compile.
    if (
      decision === SubmissionReviewDecision.APPROVE &&
      (!target.hasScanResult || !target.hasFinalizedRevision)
    ) {
      throw SubmissionScanIncompleteException;
    }
    return;
  }
  if (target.scanStatus === SubmissionScanStatus.FAILED) {
    if (decision === SubmissionReviewDecision.APPROVE) {
      throw SubmissionScanFailedException;
    }
    return;
  }
  // Unreachable today, kept so this never approves a status it was not taught to judge.
  throw SubmissionScanIncompleteException;
}

function assertApprovalEligible(eligibility: ApprovalEligibility | null): void {
  if (!eligibility) {
    throw SubmissionNotEligibleForApprovalException;
  }
  if (!RELEASABLE_PRODUCT_STATUSES.includes(eligibility.productStatus)) {
    throw SubmissionNotEligibleForApprovalException;
  }
  if (
    eligibility.publisherDeletedAt !== null ||
    eligibility.publisherStatus !== PublisherAccountStatus.ACTIVE
  ) {
    throw SubmissionNotEligibleForApprovalException;
  }
}
