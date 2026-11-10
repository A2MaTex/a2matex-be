import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import type { ProductStatusType } from '../../shared/constants/product.constant.ts';
import type { PublisherAccountStatusType } from '../../shared/constants/publisher.constant.ts';
import { SubmissionStatus } from '../../shared/constants/submission.constant.ts';
import type {
  SubmissionScanStatusType,
  SubmissionStatusType,
} from '../../shared/constants/submission.constant.ts';
import type { SubmissionReviewFeedbackType } from '../../entities/submission.model.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';

export type SubmissionReviewIdentity = {
  id: string;
  productId: string;
  createdById: string;
  status: SubmissionStatusType;
};

export type SubmissionReviewTarget = {
  id: string;
  status: SubmissionStatusType;
  scanStatus: SubmissionScanStatusType;
  hasScanResult: boolean;
  reviewedAt: Date | null;
  reviewFeedback: unknown;
};

export type ApprovalEligibility = {
  productStatus: ProductStatusType;
  publisherStatus: PublisherAccountStatusType;
  publisherDeletedAt: Date | null;
};

@Injectable()
export class SubmissionReviewRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  // Read outside the transaction only to learn which Product to lock first. Every value
  // the decision depends on is re-read under the lock.
  getIdentity(submissionId: string): Promise<SubmissionReviewIdentity | null> {
    return this.prisma.submission.findFirst({
      where: { id: submissionId, deletedAt: null },
      select: { id: true, productId: true, createdById: true, status: true },
    });
  }

  // First lock of the order the create path established (Product before Submission), and
  // the one read that decides approval eligibility. `OF p` keeps the Publisher row out of
  // the lock: its status is read, never mutated here.
  async lockProductForApproval(productId: string): Promise<ApprovalEligibility | null> {
    const rows = await this.prisma.$queryRaw<ApprovalEligibility[]>`
      SELECT
        p.status AS "productStatus",
        pa.status AS "publisherStatus",
        pa."deletedAt" AS "publisherDeletedAt"
      FROM "Product" p
      JOIN "PublisherAccount" pa ON pa.id = p."publisherAccountId"
      WHERE p.id = ${productId}::uuid
        AND p."deletedAt" IS NULL
      FOR UPDATE OF p
    `;
    return rows[0] ?? null;
  }

  // The lock is what serialises two Admins deciding the same Submission. `scanResult` is
  // only asked about, never selected: the decision needs to know that evidence exists,
  // not to carry the findings through the service.
  async lockSubmissionForReview(submissionId: string): Promise<SubmissionReviewTarget | null> {
    const rows = await this.prisma.$queryRaw<SubmissionReviewTarget[]>`
      SELECT
        id,
        status,
        "scanStatus",
        ("scanResult" IS NOT NULL) AS "hasScanResult",
        "reviewedAt",
        "reviewFeedback"
      FROM "Submission"
      WHERE id = ${submissionId}::uuid
        AND "deletedAt" IS NULL
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  // Exactly the five review-owned fields. The frozen snapshots, the release request, the
  // review context and every scan column stay untouched. The caller holds the row lock,
  // so the predicates are defence in depth: without them a caller that forgets the lock
  // would overwrite a terminal decision or a soft-deleted row instead of writing nothing.
  async applyDecision({
    submissionId,
    status,
    reviewedAt,
    feedback,
    userId,
  }: {
    submissionId: string;
    status: SubmissionStatusType;
    reviewedAt: Date;
    feedback: SubmissionReviewFeedbackType | null;
    userId: string;
  }): Promise<number> {
    const { count } = await this.prisma.submission.updateMany({
      where: { id: submissionId, deletedAt: null, status: SubmissionStatus.READY_FOR_REVIEW },
      data: {
        status,
        reviewedAt,
        reviewFeedback: feedback === null ? Prisma.DbNull : feedback,
        updatedAt: reviewedAt,
        updatedById: userId,
      },
    });
    return count;
  }
}
