import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProductReleasePackageService } from './product-release-package.service.ts';
import { SubmissionRepository } from '../../../shared/repositories/submission.repo.ts';
import { ProductReleaseRepository } from '../../../shared/repositories/product-release.repo.ts';
import { randomUUID } from 'crypto';
import { StaticService } from '../../../shared/services/static.service.ts';
import { TransactionService } from '../../../shared/services/transaction.service.ts';
import { ProductReleaseBuildRequestedPayloadType } from '../product-release-build.model.ts';
import {
  BuildFailureCode,
  BuildOutcome,
  PRODUCT_RELEASE_ENCRYPTION_ALGORITHM,
  ProductReleaseStatus,
} from '../../../shared/constants/product-release.constant.ts';
import {
  AES_GCM_NONCE_BYTES,
  WRAPPED_CONTENT_KEY_BYTES,
} from '../../../shared/constants/key.constant.ts';
import { ProductStatus } from '../../../shared/constants/product.constant.ts';
import { PublisherAccountStatus } from '../../../shared/constants/publisher.constant.ts';
import { PRODUCT_RELEASE_STATIC_PREFIX } from '../../../shared/constants/storage.constant.ts';
import {
  SubmissionScanStatus,
  SubmissionStatus,
} from '../../../shared/constants/submission.constant.ts';
import { isUniqueConstraintPrismaError } from '../../../shared/utils/prisma.ts';
import type { CreateProductReleaseInput } from '../../../shared/repositories/product-release.repo.ts';

@Injectable()
export class ProjectReleaseService {
  private readonly logger = new Logger(ProjectReleaseService.name);

  constructor(
    @Inject(ProductReleasePackageService)
    private readonly productReleasePackageService: ProductReleasePackageService,
    @Inject(SubmissionRepository) private readonly submissionRepo: SubmissionRepository,
    @Inject(ProductReleaseRepository) private readonly productReleaseRepo: ProductReleaseRepository,
    @Inject(StaticService) private readonly staticService: StaticService,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
  ) {}
  async build(body: ProductReleaseBuildRequestedPayloadType) {
    let productReleaseId: string | undefined;
    let operation = 'load_submission';
    let buildFailureCode: string | undefined;
    let candidate: { staticId: string; objectKey: string } | undefined;
    try {
      const submission = await this.submissionRepo.findById(body.submissionId);
      if (!submission) {
        this.logger.error(`Find no submission with id = ${body.submissionId}`);
        buildFailureCode = BuildFailureCode.SUBMISSION_NOT_FOUND;
        return BuildOutcome.INVALID;
      }
      if (submission.status !== SubmissionStatus.APPROVED) {
        this.logger.error(
          `Submission with id = ${body.submissionId} has not been approved by admin`,
        );
        buildFailureCode = BuildFailureCode.NOT_APPROVE_YET;
        return BuildOutcome.INVALID;
      }
      if (submission.scanStatus !== SubmissionScanStatus.PASSED) {
        this.logger.error(`Submission with id = ${body.submissionId} has not passed Scan Workflow`);
        buildFailureCode = BuildFailureCode.NOT_PASS_SCAN;
        return BuildOutcome.INVALID;
      }
      if (!submission?.runtimeIr || !submission?.contentHash) {
        this.logger.error(
          `WorkflowRevision of Submission with id = ${body.submissionId} does not have runtimeIr or contentHash`,
        );
        buildFailureCode = BuildFailureCode.MISSING_RUNTIMEIR_CONTENTHASH;
        return BuildOutcome.INVALID;
      }

      // Idempotent by submissionId: one release per Submission, whatever its status.
      const existing = await this.productReleaseRepo.findBySubmissionId(body.submissionId);
      if (existing?.status === ProductReleaseStatus.PUBLISHED) {
        this.logger.debug(`Submission with id = ${body.submissionId} has been published`);
        buildFailureCode = BuildFailureCode.ALREADY_PUBLISHED;
        return BuildOutcome.COMPLETED;
      }
      if (existing?.status === ProductReleaseStatus.DISABLED) {
        this.logger.error(`Release of submission ${body.submissionId} is disabled, not rebuilding`);
        buildFailureCode = BuildFailureCode.DISABLE_RELEASE;
        return BuildOutcome.INVALID;
      }

      operation = 'claim_release';
      const productRelease =
        existing ??
        (await this.createRelease({
          id: randomUUID(),
          productId: submission.productId,
          submissionId: submission.id,
          version: submission.releaseRequest.version,
          createdById: body.createdById,
        }));

      productReleaseId = productRelease.id;

      operation = 'build_package';
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

      operation = 'reserve_candidate';
      const packageStatic = await this.reservePackageStatic({
        productReleaseId: productRelease.id,
        packageSize,
        originalFileName: `${submission.productSnapshot.slug}-${submission.releaseRequest.version}.a2m`,
      });
      if (packageStatic.outcome === 'alreadyPublished') {
        return BuildOutcome.COMPLETED;
      }
      if (packageStatic.outcome === 'disabled') {
        buildFailureCode = BuildFailureCode.DISABLE_SUBMISSION;
        return BuildOutcome.INVALID;
      }

      candidate = packageStatic;
      this.logger.debug(
        `Product release build candidate claimed submissionId=${body.submissionId} ` +
          `releaseId=${productRelease.id} staticId=${candidate.staticId}`,
      );

      // Every attempt owns a fresh object. A superseded upload cannot overwrite a winner.
      operation = 'upload_candidate';
      await this.staticService.uploadReservedFile({
        objectKey: packageStatic.objectKey,
        body: packageBuffer,
        contentType: 'application/zip',
        size: packageSize,
      });

      // Verify this candidate outside database transactions; retries use another object.
      operation = 'verify_candidate';
      await this.staticService.verifyUploadedObject(packageStatic.objectKey, {
        size: packageSize,
        contentType: 'application/zip',
      });

      // Publish only while this attempt still owns packageStaticId. Product selection
      // and lifecycle remain the Publisher's responsibility.
      operation = 'publish_candidate';
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

      if (publication.outcome === 'published') {
        return BuildOutcome.COMPLETED;
      }

      const published = await this.cleanUncommittedPackage({
        releaseId: productRelease.id,
        ...candidate,
        buildFailureCode: BuildFailureCode.NO_LONGER_ELIGIBLE,
      });
      if (published) {
        return BuildOutcome.COMPLETED;
      }
      return publication.outcome === 'superseded' || publication.outcome === 'alreadyTerminal'
        ? BuildOutcome.RETRY
        : BuildOutcome.INVALID;
    } catch (error) {
      this.logger.error(
        `Product release build failed operation=${operation} submissionId=${body.submissionId} ` +
          `releaseId=${productReleaseId ?? 'unclaimed'} staticId=${candidate?.staticId ?? 'unclaimed'} ` +
          `reason=${error instanceof Error ? error.name : 'UnknownError'}`,
      );
      // Without a claimed candidate there is no ownership proof for a failure write.
      // After an uncertain publication, cleanup rechecks the committed row first.
      if (productReleaseId && candidate) {
        const published = await this.cleanUncommittedPackage({
          releaseId: productReleaseId,
          ...candidate,
          buildFailureCode: buildFailureCode ?? BuildFailureCode.FAILED,
        });
        if (published) {
          return BuildOutcome.COMPLETED;
        }
      }
      return BuildOutcome.RETRY;
    }
  }

  private async createRelease(input: CreateProductReleaseInput) {
    try {
      return await this.productReleaseRepo.create(input);
    } catch (error) {
      if (isUniqueConstraintPrismaError(error)) {
        // Only join the same Submission. A different Submission claiming the same
        // Product/version is still a real conflict, not permission to reuse its row.
        const existing = await this.productReleaseRepo.findBySubmissionId(input.submissionId);
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  // The latest reservation owns publication. Never reuse an earlier attempt's object.
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

      const created = await this.staticService.reserveFile({
        originalFileName,
        contentType: 'application/zip',
        size: packageSize,
        prefix: PRODUCT_RELEASE_STATIC_PREFIX,
      });
      await this.productReleaseRepo.update(
        {
          packageStaticId: created.id,
          status: ProductReleaseStatus.BUILDING,
          buildFailureCode: null,
        },
        productReleaseId,
      );
      return { outcome: 'reserved', staticId: created.id, objectKey: created.objectKey };
    });
  }

  // Short Product-first transaction: check candidate ownership and commit its exact
  // bytes/hash/key metadata together, without R2 calls or Product mutations.
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
    | { outcome: 'superseded' }
  > {
    return this.transactionService.runInTransaction(async () => {
      // Lock the Product first (shared Product-first lock order).
      const product = await this.productReleaseRepo.lockProductForPublication(args.productId);
      if (!product) {
        this.logger.error(
          `Publication rejected: product not found/deleted productId=${args.productId}`,
        );
        return { outcome: 'ineligible' };
      }

      // Recheck mutable Product status and Publisher eligibility. Only a DRAFT (first
      // release) or ACTIVE (update) Product with an active, non-deleted Publisher may
      // publish; a Product suspended/archived/blocked during build must not publish.
      const productEligible =
        (product.productStatus === ProductStatus.DRAFT ||
          product.productStatus === ProductStatus.ACTIVE) &&
        product.publisherStatus === PublisherAccountStatus.ACTIVE &&
        product.publisherDeletedAt === null;
      if (!productEligible) {
        this.logger.error(
          `Publication rejected: ineligible product status=${product.productStatus} ` +
            `publisherStatus=${product.publisherStatus} productId=${args.productId}`,
        );
        return { outcome: 'ineligible' };
      }

      // Lock the ProductRelease and require BUILDING (or succeed if already terminal).
      const release = await this.productReleaseRepo.lockBuildingForPublication(
        args.releaseId,
        args.productId,
      );
      if (!release) {
        this.logger.error(`Publication rejected: release not found releaseId=${args.releaseId}`);
        return { outcome: 'ineligible' };
      }
      if (release.status === ProductReleaseStatus.PUBLISHED) {
        return { outcome: 'alreadyTerminal' };
      }
      if (release.status !== ProductReleaseStatus.BUILDING) {
        // DISABLED (Admin disabled it mid-build) or otherwise non-BUILDING: the build
        // cannot publish into this release.
        this.logger.error(
          `Publication rejected: release status=${release.status} releaseId=${args.releaseId}`,
        );
        return { outcome: 'disabled' };
      }

      // A newer reservation fences this attempt without failing the newer owner.
      if (release.packageStaticId !== args.staticId) {
        this.logger.debug(
          `Publication superseded releaseId=${args.releaseId} ` +
            `stored=${release.packageStaticId} reserved=${args.staticId}`,
        );
        return { outcome: 'superseded' };
      }

      // Verify the reserved Static metadata still matches the uploaded package.
      const reserved = await this.staticService.getReservedFile(args.staticId);
      if (
        !reserved ||
        reserved.objectKey !== args.objectKey ||
        reserved.contentType !== 'application/zip' ||
        Number(reserved.size) !== args.packageSize
      ) {
        this.logger.error(
          `Publication rejected: reserved static mismatch staticId=${args.staticId}`,
        );
        return { outcome: 'ineligible' };
      }

      // Validate the wrapped key and its wrapping nonce against the shared crypto contract.
      if (
        !Buffer.isBuffer(args.wrappedKey) ||
        args.wrappedKey.length !== WRAPPED_CONTENT_KEY_BYTES ||
        !Buffer.isBuffer(args.contentKeyNonce) ||
        args.contentKeyNonce.length !== AES_GCM_NONCE_BYTES
      ) {
        throw new Error('Incomplete release key material');
      }

      const publishedAt = new Date();

      // Publish the release, conditional on BUILDING so a concurrent terminal
      // transition can never be overwritten. Clears the failure code on success.
      const published = await this.productReleaseRepo.markPublished(args.releaseId, {
        packageHash: args.packageHash,
        wrappedKey: args.wrappedKey,
        nonce: args.contentNonce,
        contentKeyNonce: args.contentKeyNonce,
        algorithm: PRODUCT_RELEASE_ENCRYPTION_ALGORITHM,
        packageStaticId: args.staticId,
        publishedAt,
      });
      if (published === 0) {
        return { outcome: 'alreadyTerminal' };
      }
      return { outcome: 'published' };
    });
  }

  // Lock before cleanup so an uncertain commit, Admin disable or newer attempt
  // cannot make us delete the published object or clear another attempt's pointer.
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
  }): Promise<boolean> {
    let cleanup: { deleteObject: boolean; published: boolean };
    try {
      cleanup = await this.transactionService.runInTransaction(async () => {
        const release = await this.productReleaseRepo.lockForReservation(releaseId);
        const published = release?.status === ProductReleaseStatus.PUBLISHED;
        if (release?.packageStaticId === staticId && (published || release.publishedAt !== null)) {
          // Admin may have disabled a committed publication before reconciliation.
          return { deleteObject: false, published };
        }
        if (release?.packageStaticId === staticId) {
          const failed = release.status === ProductReleaseStatus.BUILDING;
          const cleared = await this.productReleaseRepo.clearPackageStatic({
            releaseId,
            staticId,
            status: failed ? ProductReleaseStatus.BUILD_FAILED : undefined,
            buildFailureCode: failed ? buildFailureCode : undefined,
          });
          if (cleared !== 1) {
            throw new Error('Build candidate ownership changed during cleanup');
          }
        }
        await this.staticService.removeReservedFile(staticId);
        return { deleteObject: true, published };
      });
    } catch (error) {
      this.logger.error(
        `Build candidate cleanup deferred releaseId=${releaseId} staticId=${staticId} ` +
          `reason=${error instanceof Error ? error.name : 'UnknownError'}`,
      );
      // A transaction/commit failure is not proof that the object is unreferenced.
      return false;
    }

    if (cleanup.deleteObject) {
      try {
        await this.staticService.deleteReservedObject(objectKey);
      } catch (error) {
        this.logger.error(
          `Build candidate object cleanup deferred releaseId=${releaseId} staticId=${staticId} ` +
            `reason=${error instanceof Error ? error.name : 'UnknownError'}`,
        );
      }
    }
    return cleanup.published;
  }
}
