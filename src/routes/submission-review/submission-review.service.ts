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
    // Only the unrestricted grant may decide. An OWN grant on this route is not a weaker
    // form of the same permission, it is the wrong caller.
    if (!scopes.includes(null)) {
      throw SubmissionAccessDeniedException;
    }

    const identity = await this.submissionReviewRepo.getIdentity(submissionId);
    if (!identity) {
      throw SubmissionNotFoundException;
    }
    // An Admin who also publishes must not sign off on a Submission they created.
    if (identity.createdById === userId) {
      throw SubmissionSelfReviewForbiddenException;
    }

    try {
      await this.commitDecision({ identity, data, userId });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      // The decision rolled back entirely, so sending the same request again is both
      // safe and what the Admin should do. Approval waits on a Product lock the create
      // path may hold for its own, longer budget.
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
    // Approval depends on Product state, so it takes the Product lock first and keeps the
    // order the create path established. A Submission that is already terminal is skipped:
    // a terminal status never reverts, so that request can only be a replay, and holding
    // an exclusive Product lock for a request that writes nothing blocks every concurrent
    // create on the same Product.
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
      // An identical replay writes nothing. Approval still republishes: that is the
      // documented recovery for a decision that committed before publication succeeded.
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
    // Unreachable while the row lock above is held; it stays because the guard in the
    // repository is what makes that lock a requirement rather than an assumption.
    if (updated === 0) {
      throw SubmissionNotReadyForReviewException;
    }

    if (approving) {
      await this.publishAfterCommit({ identity, occurredAt: reviewedAt });
    }
  }

  // A terminal Submission accepts only the decision it already carries, with the same
  // feedback. Anything else is a conflict rather than an edit.
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

  // Identifiers only: Product Release loads the approved Submission, the frozen revision
  // and the snapshots from PostgreSQL itself. `occurredAt` comes from the stored review
  // time so a republish emits the same message as the original approval.
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
    try {
      await this.queue.publish({
        topic: KAFKA_TOPICS.PRODUCT_RELEASE_BUILD_REQUESTED,
        key: productId,
        message: {
          id: messageId,
          type: PRODUCT_RELEASE_BUILD_MESSAGE_TYPE,
          occurredAt: occurredAt.toISOString(),
          payload: { submissionId },
        },
      });
    } catch (error) {
      // Identifiers only: feedback, scan findings and payload contents stay out of logs.
      this.logger.error(
        `Product Release build publication failed submissionId=${submissionId} ` +
          `productId=${productId} messageId=${messageId}: ` +
          `${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw ProductReleaseBuildPublishFailedException;
    }
  }
}

function assertScanEligible(
  target: SubmissionReviewTarget,
  decision: SubmissionReviewDecisionType,
): void {
  if (target.scanStatus === SubmissionScanStatus.PASSED) {
    // Approval authorises a build from the stored evidence, so the evidence must exist.
    if (decision === SubmissionReviewDecision.APPROVE && !target.hasScanResult) {
      throw SubmissionScanIncompleteException;
    }
    return;
  }
  if (target.scanStatus === SubmissionScanStatus.FAILED) {
    // A failed business scan can be refused but not approved: an override needs its own
    // audited contract.
    if (decision === SubmissionReviewDecision.APPROVE) {
      throw SubmissionScanFailedException;
    }
    return;
  }
  // Unreachable today: READY_FOR_REVIEW is only ever set together with PASSED or FAILED,
  // and nothing moves a finished scan back to QUEUED, RUNNING or ERROR. It stays because
  // this function must not approve a scan status it was never taught to judge.
  throw SubmissionScanIncompleteException;
}

// External state can change after the scan and before the decision, and Product Release
// has to repeat these checks because it can change again before the build runs.
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
