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
  // Product Release packages the stored Runtime IR and never compiles, so approval is the
  // last point that can still refuse a revision the scan left pending.
  hasFinalizedRevision: boolean;
  reviewedAt: Date | null;
  reviewFeedback: unknown;
};

export type SubmissionNotificationTarget = {
  email: string;
  submissionNumber: number;
  productName: string | null;
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

  getIdentity(submissionId: string): Promise<SubmissionReviewIdentity | null> {
    return this.prisma.submission.findFirst({
      where: { id: submissionId, deletedAt: null },
      select: { id: true, productId: true, createdById: true, status: true },
    });
  }

  // First lock of the order the create path established: Product before Submission.
  // `OF p` keeps the Publisher row out of it, its status is read but never mutated.
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

  async lockSubmissionForReview(submissionId: string): Promise<SubmissionReviewTarget | null> {
    const rows = await this.prisma.$queryRaw<SubmissionReviewTarget[]>`
      SELECT
        s.id,
        s.status,
        s."scanStatus",
        (s."scanResult" IS NOT NULL) AS "hasScanResult",
        (wr."runtimeIr" IS NOT NULL AND wr."contentHash" IS NOT NULL) AS "hasFinalizedRevision",
        s."reviewedAt",
        s."reviewFeedback"
      FROM "Submission" s
      JOIN "WorkflowRevision" wr ON wr.id = s."workflowRevisionId"
      WHERE s.id = ${submissionId}::uuid
        AND s."deletedAt" IS NULL
      FOR UPDATE OF s
    `;
    return rows[0] ?? null;
  }

  async getNotificationTarget(submissionId: string): Promise<SubmissionNotificationTarget | null> {
    const rows = await this.prisma.$queryRaw<SubmissionNotificationTarget[]>`
      SELECT
        u.email,
        s.number AS "submissionNumber",
        s."productSnapshot" ->> 'name' AS "productName"
      FROM "Submission" s
      JOIN "User" u ON u.id = s."createdById"
      WHERE s.id = ${submissionId}::uuid
        AND s."deletedAt" IS NULL
        AND u."deletedAt" IS NULL
    `;
    return rows[0] ?? null;
  }

  // The caller holds the row lock, so the predicates are defence in depth: without them
  // a caller that forgets it would overwrite a terminal decision instead of writing nothing.
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
