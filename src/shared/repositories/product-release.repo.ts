import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import { ProductReleaseStatus, type ProductReleaseStatusType } from '../constants/product-release.constant.ts';
import type { ProductStatusType } from '../constants/product.constant.ts';
import type { PublisherAccountStatusType } from '../constants/publisher.constant.ts';
import { PrismaService } from '../services/prisma.service.ts';

export type CreateProductReleaseInput = {
  id: string;
  productId: string;
  submissionId: string;
  version: string;
  createdById: string;
};
export type CreateProductReleaseOutput = {
  id: string;
};

export type UpdateProductReleaseInput = {
  status?: string;
  packageStaticId?: string;
  packageHash?: string;
  wrappedKey?: string;
  nonce?: string;
  contentKeyNonce?: string;
  algorithm?: string;
  buildFailureCode?: string;
};

export type FindProductReleaseOutput = {
  id: string;
  status: ProductReleaseStatusType;
};

export type LockForReservationOutput = {
  id: string;
  status: ProductReleaseStatusType;
  packageStaticId: string | null;
};

// Product + Publisher eligibility read under the Product lock during publication.
export type PublicationProductRow = {
  productStatus: ProductStatusType;
  currentReleaseId: string | null;
  publisherStatus: PublisherAccountStatusType;
  publisherDeletedAt: Date | null;
};

// The release being published, read under its row lock together with its Submission
// number (the immutable same-Product ordering source for the stale-release guard).
export type PublicationReleaseRow = {
  id: string;
  status: ProductReleaseStatusType;
  packageStaticId: string | null;
  submissionId: string;
  createdById: string;
  submissionNumber: number;
};

export type MarkPublishedInput = {
  packageHash: string;
  wrappedKey: Buffer;
  nonce: Buffer;
  contentKeyNonce: Buffer;
  algorithm: string;
  packageStaticId: string;
  publishedAt: Date;
};

@Injectable()
export class ProductReleaseRepository {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  create(input: CreateProductReleaseInput): Promise<CreateProductReleaseOutput> {
    return this.prisma.productRelease.create({
      data: input,
      select: {
        id: true,
      },
    });
  }

  // One release per Submission (`submissionId` is unique), whatever its status.
  findBySubmissionId(submissionId: string): Promise<FindProductReleaseOutput | null> {
    return this.prisma.productRelease.findUnique({
      where: { submissionId },
      select: {
        id: true,
        status: true,
      },
    });
  }

  // Locks the ProductRelease row for the reservation transaction. Reading the status
  // under the lock means a build cannot race a concurrent publication or Admin disable.
  async lockForReservation(id: string): Promise<LockForReservationOutput | null> {
    const rows = await this.prisma.$queryRaw<LockForReservationOutput[]>`
      SELECT id, status, "packageStaticId"
      FROM "ProductRelease"
      WHERE id = ${id}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  // Step 9.1: lock the Product first (shared Product-first lock order). Reads the
  // mutable status/deletion/current-release pointer and the Publisher eligibility so the
  // publication transaction can recheck them before committing. `OF p` keeps the
  // Publisher row out of the lock: it is read, never mutated.
  async lockProductForPublication(productId: string): Promise<PublicationProductRow | null> {
    const rows = await this.prisma.$queryRaw<PublicationProductRow[]>`
      SELECT
        p.status AS "productStatus",
        p."currentReleaseId",
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

  // Step 9.2: lock the ProductRelease and require BUILDING. Joins the Submission so the
  // caller has the new release's number for the stale-release guard without a second query.
  async lockBuildingForPublication(
    releaseId: string,
    productId: string,
  ): Promise<PublicationReleaseRow | null> {
    const rows = await this.prisma.$queryRaw<PublicationReleaseRow[]>`
      SELECT
        pr.id,
        pr.status,
        pr."packageStaticId",
        pr."submissionId",
        pr."createdById",
        s.number AS "submissionNumber"
      FROM "ProductRelease" pr
      JOIN "Submission" s ON s.id = pr."submissionId"
      WHERE pr.id = ${releaseId}::uuid
        AND pr."productId" = ${productId}::uuid
      FOR UPDATE OF pr
    `;
    return rows[0] ?? null;
  }

  // Step 9.7: read the current release's Submission number while the Product lock keeps
  // `currentReleaseId` stable. No row lock is needed beyond the Product lock.
  async getCurrentReleaseNumber(currentReleaseId: string): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<{ submissionNumber: number }[]>`
      SELECT s.number AS "submissionNumber"
      FROM "ProductRelease" pr
      JOIN "Submission" s ON s.id = pr."submissionId"
      WHERE pr.id = ${currentReleaseId}::uuid
    `;
    return rows[0]?.submissionNumber ?? null;
  }

  // Step 9.8: publish the release. Conditional on BUILDING so a concurrent terminal
  // transition can never be overwritten. Clears the failure code on success.
  async markPublished(releaseId: string, input: MarkPublishedInput): Promise<number> {
    const { count } = await this.prisma.productRelease.updateMany({
      where: { id: releaseId, status: ProductReleaseStatus.BUILDING },
      data: {
        status: ProductReleaseStatus.PUBLISHED,
        packageHash: input.packageHash,
        wrappedKey: input.wrappedKey,
        nonce: input.nonce,
        contentKeyNonce: input.contentKeyNonce,
        algorithm: input.algorithm,
        packageStaticId: input.packageStaticId,
        publishedAt: input.publishedAt,
        buildFailureCode: null,
        updatedAt: input.publishedAt,
      } as Prisma.ProductReleaseUncheckedUpdateManyInput,
    });
    return count;
  }

  // Permanent-failure cleanup: mark a still-BUILDING release failed and drop its Static
  // pointer so the Static row can be deleted without an FK violation. Returns 0 when the
  // release is no longer BUILDING (e.g. Admin disabled it mid-build).
  async markBuildFailedAndClearStatic(
    releaseId: string,
    buildFailureCode: string,
  ): Promise<number> {
    const { count } = await this.prisma.productRelease.updateMany({
      where: { id: releaseId, status: ProductReleaseStatus.BUILDING },
      data: {
        status: ProductReleaseStatus.BUILD_FAILED,
        buildFailureCode,
        packageStaticId: null,
        updatedAt: new Date(),
      },
    });
    return count;
  }

  // Drop the Static pointer on a release that is no longer BUILDING, so the Static row
  // can be deleted without leaving a dangling reference. Does not change status.
  async clearPackageStatic(releaseId: string): Promise<void> {
    await this.prisma.productRelease.update({
      where: { id: releaseId },
      data: { packageStaticId: null, updatedAt: new Date() },
    });
  }

  update(input: Object, id: string) {
    return this.prisma.productRelease.update({ data: input, where: { id } });
  }
}
