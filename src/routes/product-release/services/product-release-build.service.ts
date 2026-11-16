import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProductReleasePackageService } from './product-release-package.service.ts';
import { SubmissionRepository } from '../../../shared/repositories/submission.repo.ts';
import { ProductReleaseRepository } from '../../../shared/repositories/product-release.repo.ts';
import { randomUUID } from 'crypto';
import { SharedUserRepository } from '../../../shared/repositories/shared-user.repo.ts';
import { StaticService } from '../../../shared/services/static.service.ts';
import { TransactionService } from '../../../shared/services/transaction.service.ts';
import { ProductReleaseBuildRequestedPayloadType } from '../product-release-build.model.ts';
import { ProductReleaseStatus } from '../../../shared/constants/product-release.constant.ts';
import { ProductStatus } from '../../../shared/constants/product.constant.ts';
import { PublisherAccountStatus } from '../../../shared/constants/publisher.constant.ts';
import { PRODUCT_RELEASE_STATIC_PREFIX } from '../../../shared/constants/storage.constant.ts';
import {
  SubmissionScanStatus,
  SubmissionStatus,
} from '../../../shared/constants/submission.constant.ts';
import { ProductRepo } from '../../product/product.repo.ts';
import { generateRandomFilename } from '../../../shared/utils/utils.ts';

// COMPLETED: the release is PUBLISHED (also when it already was, so a redelivery is a no-op).
// INVALID:   permanent, retrying cannot help (missing/unapproved Submission, disabled release).
// RETRY:     the build failed part-way and left the release BUILD_FAILED; building again may work.
export const BuildOutcome = {
  COMPLETED: 'COMPLETED',
  RETRY: 'RETRY',
  INVALID: 'INVALID',
} as const;

export const BuildFailureCode = {
  SUBMISSION_NOT_FOUND: 'SUBMISSION_NOT_FOUND',
  NOT_APPROVE_YET: 'NOT_APPROVE_YET',
  DISABLE_SUBMISSION: 'DISABLE_SUBMISSION',
  NOT_PASS_SCAN: 'NOT_PASS_SCAN',
} as const;

export type BuildOutcomeType = (typeof BuildOutcome)[keyof typeof BuildOutcome];

@Injectable()
export class ProjectReleaseService {
  private readonly logger = new Logger(ProjectReleaseService.name);

  constructor(
    @Inject(ProductReleasePackageService)
    private readonly productReleasePackageService: ProductReleasePackageService,
    @Inject(SubmissionRepository) private readonly submissionRepo: SubmissionRepository,
    @Inject(ProductReleaseRepository) private readonly productReleaseRepo: ProductReleaseRepository,
    @Inject(StaticService) private readonly staticService: StaticService,
    @Inject(ProductRepo) private readonly productRepo: ProductRepo,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
  ) {}
  async build(body: ProductReleaseBuildRequestedPayloadType) {
    let productReleaseId: string | undefined;
    try {
      const submission = await this.submissionRepo.findById(body.submissionId);
      if (!submission) {
        this.logger.error(`Find no submission with id = ${body.submissionId}`);
        return BuildOutcome.INVALID;
      }
      if (submission.status !== SubmissionStatus.APPROVED) {
        this.logger.error(
          `Submission with id = ${body.submissionId} has not been approved by admin`,
        );
        return BuildOutcome.INVALID;
      }
      if (submission.scanStatus !== SubmissionScanStatus.PASSED) {
        this.logger.error(`Submission with id = ${body.submissionId} has not passed Scan Workflow`);
        return BuildOutcome.INVALID;
      }
      if (!submission?.runtimeIr || !submission?.contentHash) {
        this.logger.error(
          `WorkflowRevision of Submission with id = ${body.submissionId} does not have runtimeIr or contentHash`,
        );
        return BuildOutcome.INVALID;
      }

      // Idempotent by submissionId: one release per Submission, whatever its status.
      const existing = await this.productReleaseRepo.findBySubmissionId(body.submissionId);
      if (existing?.status === ProductReleaseStatus.PUBLISHED) {
        this.logger.debug(`Submission with id = ${body.submissionId} has been published`);
        return BuildOutcome.COMPLETED;
      }
      if (existing?.status === ProductReleaseStatus.DISABLED) {
        this.logger.error(`Release of submission ${body.submissionId} is disabled, not rebuilding`);
        return BuildOutcome.INVALID;
      }

      // No release yet: create it. BUILDING (crashed mid-build) or BUILD_FAILED: reuse it and
      // build again. A rebuild generates a new content key and replaces the package fields.
      const productRelease =
        existing ??
        (await this.productReleaseRepo.create({
          id: randomUUID(),
          productId: submission.productId,
          submissionId: submission.id,
          version: submission.releaseRequest.version,
          createdById: body.createdById,
        }));

      productReleaseId = productRelease.id;

      const { packageBuffer, packageHash, packageSize, contentNonce, wrappedKey, contentKeyNonce } =
        await this.productReleasePackageService.buildPackage({
          productId: submission?.productId,
          releaseId: productRelease.id,
          version: submission.releaseRequest.version,
          minimumLauncherVersion: submission.releaseRequest.minimumLauncherVersion,
          minimumRuntimeVersion: submission.releaseRequest.minimumRuntimeVersion,
          runtimeIr: submission.runtimeIr,
          inputSchema: submission.inputSchema,
        });

      const packageStatic = await this.reservePackageStatic({
        productReleaseId: productRelease.id,
        packageSize,
        originalFileName: `${submission.productSnapshot.slug}-${submission.releaseRequest.version}.a2m`,
      });
      if (packageStatic.outcome === 'alreadyPublished') {
        return BuildOutcome.COMPLETED;
      }
      if (packageStatic.outcome === 'disabled') {
        return BuildOutcome.INVALID;
      }

      // Upload to the reserved object key. A failure leaves the reservation in place so
      // the next attempt overwrites the same object and reuses the same Static record.
      await this.staticService.uploadReservedFile({
        objectKey: packageStatic.objectKey,
        body: packageBuffer,
        contentType: 'application/zip',
        size: packageSize,
      });

      // Step 8: verify the uploaded object landed with the expected size and content type,
      // outside the publication transaction. A mismatch is a retryable build failure; the
      // retry overwrites the same reserved object key.
      await this.staticService.verifyUploadedObject(packageStatic.objectKey, {
        size: packageSize,
        contentType: 'application/zip',
      });

      // Step 9: publication. One short transaction follows the Product-first lock order,
      // rechecks Product/Publisher eligibility, guards against a stale older build
      // replacing a newer current release, and atomically sets the release PUBLISHED and
      // the Product current pointer (DRAFT -> ACTIVE on the first current release).
      const publication = await this.runPublicationTransaction({
        productId: submission.productId,
        releaseId: productRelease.id,
        staticId: packageStatic.staticId,
        objectKey: packageStatic.objectKey,
        packageHash,
        packageSize,
        wrappedKey,
        contentNonce,
        contentKeyNonce,
      });

      if (publication.outcome === 'ineligible' || publication.outcome === 'disabled') {
        // The Product or release is no longer eligible for publication. Mark the attempt
        // failed and clean the uncommitted package (object + Static metadata) so no private
        // artifact is left behind. This is a terminal failure: the handler dead-letters it.
        await this.cleanUncommittedPackage({
          releaseId: productRelease.id,
          staticId: packageStatic.staticId,
          objectKey: packageStatic.objectKey,
          buildFailureCode: publication.outcome === 'disabled' ? 'DISABLED' : 'INELIGIBLE',
        });
        return BuildOutcome.INVALID;
      }

      // 'published' or 'alreadyTerminal' (a concurrent worker published first): success.
      return BuildOutcome.COMPLETED;
    } catch (error) {
      this.logger.error(error);
      // Best effort: if even this write fails the release stays BUILDING, which the next
      // attempt treats the same as BUILD_FAILED.
      if (productReleaseId) {
        try {
          await this.productReleaseRepo.update(
            { buildFailureCode: 'FAILED', status: ProductReleaseStatus.BUILD_FAILED },
            productReleaseId,
          );
        } catch (updateError) {
          this.logger.error(updateError);
        }
      }
      return BuildOutcome.RETRY;
    }
  }

  // Reserves one private Static record for the package before any R2 I/O, in a short
  // transaction that locks the BUILDING ProductRelease. A retry reuses the existing
  // reservation (same UUID-sharded object key) instead of creating a new Static record,
  // and refreshes the pre-publication metadata when the rebuilt package differs in size.
  private async reservePackageStatic({
    productReleaseId,
    packageSize,
    originalFileName,
  }: {
    productReleaseId: string;
    packageSize: number;
    originalFileName: string;
  }): Promise<
    | { outcome: 'reserved'; staticId: string; objectKey: string }
    | { outcome: 'alreadyPublished' }
    | { outcome: 'disabled' }
  > {
    return this.transactionService.runInTransaction(async () => {
      const release = await this.productReleaseRepo.lockForReservation(productReleaseId);
      if (!release) {
        throw new Error(`ProductRelease vanished during reservation id=${productReleaseId}`);
      }
      if (release.status === ProductReleaseStatus.PUBLISHED) {
        return { outcome: 'alreadyPublished' };
      }
      if (release.status === ProductReleaseStatus.DISABLED) {
        return { outcome: 'disabled' };
      }

      // BUILDING (first build or crashed mid-build) or BUILD_FAILED (retry): clear any
      // prior failure and (re)claim the row as BUILDING so a redelivery stays honest.
      if (release.status === ProductReleaseStatus.BUILD_FAILED) {
        await this.productReleaseRepo.update(
          { status: ProductReleaseStatus.BUILDING, buildFailureCode: null },
          productReleaseId,
        );
      }

      if (release.packageStaticId) {
        // Retry: reuse the existing reservation and its object key.
        const reserved = await this.staticService.getReservedFile(release.packageStaticId);
        if (reserved) {
          if (
            reserved.size !== BigInt(packageSize) ||
            reserved.contentType !== 'application/zip' ||
            reserved.originalFileName !== originalFileName
          ) {
            await this.staticService.updateReservedFileMetadata(reserved.id, {
              size: BigInt(packageSize),
              contentType: 'application/zip',
              originalFileName,
            });
          }
          return { outcome: 'reserved', staticId: reserved.id, objectKey: reserved.objectKey };
        }
        // The reserved id points at nothing (metadata was cleaned up): fall through and
        // allocate a fresh reservation under a new id.
      }

      const created = await this.staticService.reserveFile({
        originalFileName,
        contentType: 'application/zip',
        size: packageSize,
        prefix: PRODUCT_RELEASE_STATIC_PREFIX,
      });
      await this.productReleaseRepo.update(
        { packageStaticId: created.id },
        productReleaseId,
      );
      return { outcome: 'reserved', staticId: created.id, objectKey: created.objectKey };
    });
  }

  // Step 9: the publication transaction. Holds the Product then the ProductRelease lock,
  // rechecks eligibility, applies the stale-release guard, and commits the PUBLISHED
  // release together with the Product current pointer/status change atomically.
  private async runPublicationTransaction(args: {
    productId: string;
    releaseId: string;
    staticId: string;
    objectKey: string;
    packageHash: string;
    packageSize: number;
    wrappedKey: Buffer;
    contentNonce: Buffer;
    contentKeyNonce: Buffer;
  }): Promise<
    | { outcome: 'published' }
    | { outcome: 'alreadyTerminal' }
    | { outcome: 'ineligible' }
    | { outcome: 'disabled' }
  > {
    return this.transactionService.runInTransaction(async () => {
      // 9.1 Lock the Product first (shared Product-first lock order).
      const product = await this.productReleaseRepo.lockProductForPublication(args.productId);
      if (!product) {
        this.logger.warn(
          `Publication rejected: product not found/deleted productId=${args.productId}`,
        );
        return { outcome: 'ineligible' };
      }

      // 9.4 Recheck mutable Product status and Publisher eligibility. Only a DRAFT (first
      // release) or ACTIVE (update) Product with an active, non-deleted Publisher may
      // publish; a Product suspended/archived/blocked during build must not publish.
      const productEligible =
        (product.productStatus === ProductStatus.DRAFT ||
          product.productStatus === ProductStatus.ACTIVE) &&
        product.publisherStatus === PublisherAccountStatus.ACTIVE &&
        product.publisherDeletedAt === null;
      if (!productEligible) {
        this.logger.warn(
          `Publication rejected: ineligible product status=${product.productStatus} ` +
            `publisherStatus=${product.publisherStatus} productId=${args.productId}`,
        );
        return { outcome: 'ineligible' };
      }

      // 9.2 Lock the ProductRelease and require BUILDING (or succeed if already terminal).
      const release = await this.productReleaseRepo.lockBuildingForPublication(
        args.releaseId,
        args.productId,
      );
      if (!release) {
        this.logger.warn(`Publication rejected: release not found releaseId=${args.releaseId}`);
        return { outcome: 'ineligible' };
      }
      if (release.status === ProductReleaseStatus.PUBLISHED) {
        return { outcome: 'alreadyTerminal' };
      }
      if (release.status !== ProductReleaseStatus.BUILDING) {
        // DISABLED (Admin disabled it mid-build) or otherwise non-BUILDING: the build
        // cannot publish into this release.
        this.logger.warn(
          `Publication rejected: release status=${release.status} releaseId=${args.releaseId}`,
        );
        return { outcome: 'disabled' };
      }

      // 9.3 The release must still belong to the locked Product and point at the Static
      // record that was actually uploaded.
      if (release.packageStaticId !== args.staticId) {
        this.logger.warn(
          `Publication rejected: static id mismatch releaseId=${args.releaseId} ` +
            `stored=${release.packageStaticId} reserved=${args.staticId}`,
        );
        return { outcome: 'ineligible' };
      }

      // 9.5 Verify the reserved Static metadata still matches the uploaded package.
      const reserved = await this.staticService.getReservedFile(args.staticId);
      if (
        !reserved ||
        reserved.objectKey !== args.objectKey ||
        reserved.contentType !== 'application/zip' ||
        Number(reserved.size) !== args.packageSize
      ) {
        this.logger.warn(
          `Publication rejected: reserved static mismatch staticId=${args.staticId}`,
        );
        return { outcome: 'ineligible' };
      }

      // 9.6 Require a complete wrapped key / key-wrap nonce pair with the documented byte
      // lengths (wrappedKey = 32-byte ciphertext || 16-byte tag; keyNonce = 12 bytes).
      if (
        !Buffer.isBuffer(args.wrappedKey) ||
        args.wrappedKey.length !== 48 ||
        !Buffer.isBuffer(args.contentKeyNonce) ||
        args.contentKeyNonce.length !== 12
      ) {
        throw new Error('Incomplete release key material');
      }

      const publishedAt = new Date();

      // 9.8 Publish the release, conditional on BUILDING so a concurrent terminal
      // transition can never be overwritten. Clears the failure code on success.
      const published = await this.productReleaseRepo.markPublished(args.releaseId, {
        packageHash: args.packageHash,
        wrappedKey: args.wrappedKey,
        nonce: args.contentNonce,
        contentKeyNonce: args.contentKeyNonce,
        algorithm: 'AES-256-GCM',
        packageStaticId: args.staticId,
        publishedAt,
      });
      if (published === 0) {
        return { outcome: 'alreadyTerminal' };
      }

      // 9.7 + 9.9 Stale-release guard: a delayed older build must not replace a newer
      // current release. Submission.number is the immutable same-Product ordering source,
      // and the Product lock keeps currentReleaseId stable while it is read.
      const currentNumber = product.currentReleaseId
        ? await this.productReleaseRepo.getCurrentReleaseNumber(product.currentReleaseId)
        : null;
      const notStale = currentNumber === null || release.submissionNumber >= currentNumber;

      if (notStale) {
        // 9.9-9.11 Point the Product at the new release and activate it (DRAFT -> ACTIVE on
        // the first current release; stays ACTIVE on an update). Audit with the approving
        // admin stored on the release.
        const applied = await this.productRepo.applyPublication({
          id: args.productId,
          currentReleaseId: args.releaseId,
          actorId: release.createdById,
          now: publishedAt,
        });
        if (applied.count === 0) {
          // Unreachable under the Product lock; log defensively rather than fail the
          // committed release publication.
          this.logger.error(
            `Product current-release update matched nothing productId=${args.productId} ` +
              `releaseId=${args.releaseId}`,
          );
        }
      } else {
        this.logger.warn(
          `Stale build kept as history only: new submissionNumber=${release.submissionNumber} ` +
            `< current=${currentNumber} releaseId=${args.releaseId}`,
        );
      }

      return { outcome: 'published' };
    });
  }

  // Permanent-failure cleanup for a publication that could not commit (Product or release
  // no longer eligible). Drops the ProductRelease Static pointer, marks a still-BUILDING
  // release failed, removes the Static metadata, and deletes the uploaded object.
  private async cleanUncommittedPackage({
    releaseId,
    staticId,
    objectKey,
    buildFailureCode,
  }: {
    releaseId: string;
    staticId: string;
    objectKey: string;
    buildFailureCode: string;
  }): Promise<void> {
    // DB cleanup in one transaction: clear the FK before deleting the Static row.
    try {
      await this.transactionService.runInTransaction(async () => {
        const cleared = await this.productReleaseRepo.markBuildFailedAndClearStatic(
          releaseId,
          buildFailureCode,
        );
        if (cleared === 0) {
          // The release is no longer BUILDING (e.g. Admin disabled it mid-build); still
          // drop the Static pointer so the row is not left referencing cleaned-up metadata.
          await this.productReleaseRepo.clearPackageStatic(releaseId);
        }
        await this.staticService.removeReservedFile(staticId);
      });
    } catch (error) {
      this.logger.error(
        `Uncommitted package metadata cleanup failed releaseId=${releaseId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Object cleanup is best effort: a leftover private object is never served without an
    // entitlement check and is overwritten by a future build under a new key.
    try {
      await this.staticService.deleteReservedObject(objectKey);
    } catch (error) {
      this.logger.error(
        `Uncommitted object cleanup failed objectKey=${objectKey}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
