import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { KAFKA_TOPICS } from '../../shared/constants/kafka.constant.ts';
import { ProductStatus } from '../../shared/constants/product.constant.ts';
import {
  SUBMISSION_CREATE_TX_MAX_WAIT_MS,
  SUBMISSION_CREATE_TX_TIMEOUT_MS,
  SUBMISSION_SCAN_MESSAGE_ID_PREFIX,
  SUBMISSION_SCAN_MESSAGE_TYPE,
} from '../../shared/constants/submission.constant.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import {
  QUEUE_PROVIDER,
  type MessageProvider,
} from '../../shared/infrastructure/queue/queue.interface.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import type { Prisma } from '../../generated/prisma/client.ts';
import {
  isTransactionTimeoutPrismaError,
  isUniqueConstraintPrismaError,
} from '../../shared/utils/prisma.ts';
import {
  ProductArchivedException,
  ProductNotFoundException,
  ProductSuspendedException,
} from '../product/product.error.ts';
import { ProductRepo } from '../product/product.repo.ts';
import { describeUniqueTarget } from '../product/product.util.ts';
import { WorkflowRevisionService } from '../workflow-revision/workflow-revision.service.ts';
import type { CreateSubmissionInputType, CreateSubmissionOutputType } from './submission.model.ts';
import {
  SubmissionAlreadyOpenException,
  SubmissionIdempotencyKeyReusedException,
  SubmissionCreateTimeoutException,
  SubmissionNumberConflictException,
  SubmissionProductIncompleteException,
  SubmissionScanPublishFailedException,
} from './submission.error.ts';
import { SubmissionAccessPolicy } from './submission-access.policy.ts';
import {
  isOpenSubmission,
  SubmissionRepo,
  type ExistingIdempotentSubmission,
} from './submission.repo.ts';
import {
  buildProductSnapshot,
  buildReleaseRequestSnapshot,
  buildReviewContextSnapshot,
  calculateSubmissionRequestHash,
  isRepublishableScanStatus,
} from './submission.util.ts';

const SUBMITTABLE_PRODUCT_STATUSES: string[] = [ProductStatus.DRAFT, ProductStatus.ACTIVE];

@Injectable()
export class SubmissionService {
  private readonly logger = new Logger(SubmissionService.name);

  constructor(
    @Inject(SubmissionRepo) private readonly submissionRepo: SubmissionRepo,
    @Inject(SubmissionAccessPolicy)
    private readonly submissionAccessPolicy: SubmissionAccessPolicy,
    @Inject(ProductRepo) private readonly productRepo: ProductRepo,
    @Inject(WorkflowRevisionService)
    private readonly workflowRevisionService: WorkflowRevisionService,
    @Inject(QUEUE_PROVIDER) private readonly queue: MessageProvider,
    @Inject(TransactionService) readonly transactionService: TransactionService,
  ) {}

  async create({
    data,
    idempotencyKey,
    userId,
  }: {
    data: CreateSubmissionInputType;
    idempotencyKey: string;
    userId: string;
  }): Promise<CreateSubmissionOutputType> {
    const { publisherAccountId } = await this.submissionAccessPolicy.resolveCreateAccess(userId);
    const requestHash = calculateSubmissionRequestHash(data);

    // Checked before any snapshot work so a replayed key never rebuilds a revision.
    const claimed = await this.submissionRepo.findByIdempotencyKey({
      createdById: userId,
      idempotencyKey,
    });
    if (claimed) {
      return this.resolveReplay(claimed, requestHash);
    }

    try {
      return await this.commitCreate({
        data,
        requestHash,
        idempotencyKey,
        publisherAccountId,
        userId,
      });
    } catch (error) {
      // A concurrent request carrying this key commits the row this one was told did
      // not exist yet, and the loser rarely fails on the key's own uniqueness: it
      // usually trips an earlier business rule, or times out waiting for the Product
      // lock the winner holds. Whatever the cause, an existing row for this key means
      // the documented idempotent answer, not the failure this attempt happened to
      // hit. The probe is one indexed lookup on an already failing path.
      const concurrent = await this.submissionRepo.findByIdempotencyKey({
        createdById: userId,
        idempotencyKey,
      });
      if (concurrent) {
        return this.resolveReplay(concurrent, requestHash);
      }
      if (error instanceof HttpException) {
        throw error;
      }
      if (isUniqueConstraintPrismaError(error)) {
        throw this.translateUniqueViolation(error, data);
      }
      if (isTransactionTimeoutPrismaError(error)) {
        this.logger.error(
          `Submission create transaction timed out productId=${data.productId} ` +
            `sourceDraftVersion=${data.sourceDraftVersion}`,
        );
        throw SubmissionCreateTimeoutException;
      }
      throw error;
    }
  }

  @Transactional({
    timeout: SUBMISSION_CREATE_TX_TIMEOUT_MS,
    maxWait: SUBMISSION_CREATE_TX_MAX_WAIT_MS,
  })
  private async commitCreate({
    data,
    requestHash,
    idempotencyKey,
    publisherAccountId,
    userId,
  }: {
    data: CreateSubmissionInputType;
    requestHash: string;
    idempotencyKey: string;
    publisherAccountId: string;
    userId: string;
  }): Promise<CreateSubmissionOutputType> {
    // First lock of the documented order; WorkflowRevision takes Project and
    // ProjectDraft next, inside this same transaction.
    const product = await this.submissionRepo.lockOwnedProduct({
      productId: data.productId,
      publisherAccountId,
    });
    if (!product) {
      throw ProductNotFoundException;
    }
    if (product.status === ProductStatus.SUSPENDED) {
      throw ProductSuspendedException;
    }
    if (product.status === ProductStatus.ARCHIVED) {
      throw ProductArchivedException;
    }
    if (!SUBMITTABLE_PRODUCT_STATUSES.includes(product.status)) {
      throw ProductNotFoundException;
    }

    const media = await this.submissionRepo.getProductMedia(product.id);
    await this.assertMediaStillEligible(media);
    const productSnapshot = buildProductSnapshot({ product, media });

    const revision = await this.workflowRevisionService.createFromDraft({
      projectId: product.projectId,
      sourceDraftVersion: data.sourceDraftVersion,
      createdById: userId,
      access: { unrestricted: false, publisherAccountId },
    });

    const latest = await this.submissionRepo.getLatestSubmission(product.id);
    if (latest && isOpenSubmission(latest)) {
      throw SubmissionAlreadyOpenException;
    }

    const created = await this.submissionRepo.create({
      productId: product.id,
      workflowRevisionId: revision.id,
      number: (latest?.number ?? 0) + 1,
      productSnapshot,
      releaseRequest: buildReleaseRequestSnapshot(data.releaseRequest),
      reviewContext: buildReviewContextSnapshot(data.reviewContext),
      idempotencyKey,
      requestHash,
      createdById: userId,
    });

    // A network call must never run while the transaction holds row locks.
    await this.transactionService.afterCommit(() =>
      this.publishScanRequest({
        submissionId: created.id,
        scanAttempt: created.scanAttempt,
        occurredAt: created.createdAt,
      }),
    );

    return { id: created.id };
  }

  private translateUniqueViolation(
    error: Prisma.PrismaClientKnownRequestError,
    data: CreateSubmissionInputType,
  ): HttpException {
    const target = describeUniqueTarget(error);
    this.logger.warn(
      `Submission create hit a unique constraint target=${target} ` +
        `productId=${data.productId} sourceDraftVersion=${data.sourceDraftVersion}`,
    );
    if (target.includes('workflowrevisionid')) {
      return SubmissionAlreadyOpenException;
    }
    // (productId, number) can only collide when the per-Product lock failed to
    // serialise allocation, which is an internal invariant rather than user error.
    return SubmissionNumberConflictException;
  }

  private async resolveReplay(
    existing: ExistingIdempotentSubmission,
    requestHash: string,
  ): Promise<CreateSubmissionOutputType> {
    if (existing.requestHash !== requestHash) {
      this.logger.warn(`Idempotency key reused with different input submissionId=${existing.id}`);
      throw SubmissionIdempotencyKeyReusedException;
    }
    if (!isRepublishableScanStatus(existing.scanStatus)) {
      return { id: existing.id };
    }

    // Recovers the accepted gap where the commit succeeded but publication did not.
    // Attempt 1 carries the creation time; a later attempt carries its retry time.
    await this.publishScanRequest({
      submissionId: existing.id,
      scanAttempt: existing.scanAttempt,
      occurredAt:
        existing.scanAttempt === 1
          ? existing.createdAt
          : (existing.updatedAt ?? existing.createdAt),
    });
    return { id: existing.id };
  }

  private async assertMediaStillEligible(media: { staticId: string }[]): Promise<void> {
    if (media.length === 0) {
      return;
    }
    const staticIds = [...new Set(media.map(({ staticId }) => staticId))];
    const eligible = await this.productRepo.countEligibleMedia(staticIds);
    if (eligible !== staticIds.length) {
      throw SubmissionProductIncompleteException;
    }
  }

  private async publishScanRequest({
    submissionId,
    scanAttempt,
    occurredAt,
  }: {
    submissionId: string;
    scanAttempt: number;
    occurredAt: Date;
  }): Promise<void> {
    try {
      await this.queue.publish({
        topic: KAFKA_TOPICS.SUBMISSION_SCAN_REQUESTED,
        key: submissionId,
        message: {
          id: `${SUBMISSION_SCAN_MESSAGE_ID_PREFIX}:${submissionId}:${scanAttempt}`,
          type: SUBMISSION_SCAN_MESSAGE_TYPE,
          occurredAt: occurredAt.toISOString(),
          payload: { submissionId, scanAttempt },
        },
      });
    } catch (error) {
      this.logger.error(
        `Submission scan publication failed submissionId=${submissionId} ` +
          `scanAttempt=${scanAttempt}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw SubmissionScanPublishFailedException;
    }
  }
}
