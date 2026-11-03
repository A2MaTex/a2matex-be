import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.ts';
import type {
  SubmissionScanStatusType,
  SubmissionStatusType,
} from '../../shared/constants/submission.constant.ts';
import { SubmissionStatus } from '../../shared/constants/submission.constant.ts';
import type { ProductStatusType } from '../../shared/constants/product.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';

export type LockedSubmissionProduct = {
  id: string;
  publisherAccountId: string;
  projectId: string;
  status: ProductStatusType;
  name: string | null;
  slug: string | null;
  shortDescription: string | null;
  description: string | null;
  usageInstructions: string | null;
};

export type SubmissionProductMedia = {
  id: string;
  staticId: string;
  type: 'ICON' | 'COVER' | 'GALLERY';
  sortOrder: number;
  altText: string | null;
};

export type ExistingIdempotentSubmission = {
  id: string;
  requestHash: string;
  scanAttempt: number;
  scanStatus: SubmissionScanStatusType;
  createdAt: Date;
  updatedAt: Date | null;
};

export type LatestSubmission = {
  number: number;
  status: SubmissionStatusType;
  deletedAt: Date | null;
};

export type CreatedSubmission = {
  id: string;
  scanAttempt: number;
  createdAt: Date;
};

export type CreateSubmissionRecord = {
  productId: string;
  workflowRevisionId: string;
  number: number;
  productSnapshot: Prisma.InputJsonValue;
  releaseRequest: Prisma.InputJsonValue;
  reviewContext: Prisma.InputJsonValue;
  idempotencyKey: string;
  requestHash: string;
  createdById: string;
};

// A Submission is open while it still expects a decision; only one may exist per Product.
const OPEN_SUBMISSION_STATUSES: SubmissionStatusType[] = [
  SubmissionStatus.PENDING_SCAN,
  SubmissionStatus.READY_FOR_REVIEW,
];

export function isOpenSubmission(submission: LatestSubmission): boolean {
  return submission.deletedAt === null && OPEN_SUBMISSION_STATUSES.includes(submission.status);
}

@Injectable()
export class SubmissionRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  getPublisherAccount(userId: string) {
    return this.prisma.publisherAccount.findFirst({
      where: {
        userId,
        deletedAt: null,
      },
      select: {
        id: true,
        status: true,
      },
    });
  }

  // Claimed before any snapshot work so a replayed key never rebuilds a revision.
  findByIdempotencyKey({
    createdById,
    idempotencyKey,
  }: {
    createdById: string;
    idempotencyKey: string;
  }): Promise<ExistingIdempotentSubmission | null> {
    return this.prisma.submission.findFirst({
      where: {
        createdById,
        idempotencyKey,
      },
      select: {
        id: true,
        requestHash: true,
        scanAttempt: true,
        scanStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  // First lock of the documented order Product -> Project -> ProjectDraft -> latest
  // Submission. It serialises per-Product number allocation and the open-Submission
  // check, so neither needs its own database constraint.
  async lockOwnedProduct({
    productId,
    publisherAccountId,
  }: {
    productId: string;
    publisherAccountId: string;
  }): Promise<LockedSubmissionProduct | null> {
    const products = await this.prisma.$queryRaw<LockedSubmissionProduct[]>`
      SELECT
        id,
        "publisherAccountId",
        "projectId",
        status,
        name,
        slug,
        "shortDescription",
        description,
        "usageInstructions"
      FROM "Product"
      WHERE id = ${productId}::uuid
        AND "publisherAccountId" = ${publisherAccountId}::uuid
        AND "deletedAt" IS NULL
      FOR UPDATE
    `;
    return products[0] ?? null;
  }

  // Ordering matches the Product contract so the frozen snapshot and the mutable
  // Product read present media in the same sequence.
  getProductMedia(productId: string): Promise<SubmissionProductMedia[]> {
    return this.prisma.productMedia.findMany({
      where: {
        productId,
        deletedAt: null,
      },
      select: {
        id: true,
        staticId: true,
        type: true,
        sortOrder: true,
        altText: true,
      },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    });
  }

  // Submissions are numbered sequentially, so the newest row carries both the next
  // number and the only status that can still be open. Soft-deleted rows stay in
  // scope because UNIQUE("productId", number) has no deletedAt predicate: skipping
  // them would re-allocate a number the index still holds.
  getLatestSubmission(productId: string): Promise<LatestSubmission | null> {
    return this.prisma.submission.findFirst({
      where: { productId },
      select: {
        number: true,
        status: true,
        deletedAt: true,
      },
      orderBy: { number: 'desc' },
    });
  }

  // createdAt and scanAttempt feed the queue envelope; only `id` reaches the client.
  create(data: CreateSubmissionRecord): Promise<CreatedSubmission> {
    return this.prisma.submission.create({
      data,
      select: { id: true, scanAttempt: true, createdAt: true },
    });
  }
}
