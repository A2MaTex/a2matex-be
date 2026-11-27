import { SharedUserRepository } from '../../shared/repositories/shared-user.repo.ts';
import { ProductPackageHash, ProductPackageFileMetadata } from './product.model.ts';
import { EntitlementService } from '../entitlement/entitlement.service.ts';
import { StaticService } from '../../shared/services/static.service.ts';
import type { ObjectStorageProvider } from '../../shared/infrastructure/storage/object-storage.interface.ts';
import { OBJECT_STORAGE_PROVIDER } from '../../shared/infrastructure/storage/object-storage.interface.ts';
import envConfig from '../../shared/config.ts';
import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ProductLifecycleAction,
  ProductModerationAction,
  ProductStatus,
  MILLISECONDS_PER_SECOND,
} from '../../shared/constants/product.constant.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import { SUCCESS_RESPONSE } from '../../shared/models/response.model.ts';
import type { MessageResType } from '../../shared/models/response.model.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import { isUniqueConstraintPrismaError } from '../../shared/utils/prisma.ts';
import { ProductOfferService } from '../product-offer/product-offer.service.ts';
import { ProductReleaseManagementService } from '../product-release/product-release.service.ts';
import { ProjectNotFoundException } from '../project/project.error.ts';
import type { ProductAccess } from './product-access.model.ts';
import { ProductAccessPolicy } from './product-access.policy.ts';
import {
  ProductAlreadyExistsException,
  ProductArchivedException,
  ProductCannotBeActivatedException,
  ProductCannotBeArchivedException,
  ProductCannotBeReactivatedException,
  ProductCannotBeSuspendedException,
  ProductLifecycleUnavailableException,
  ProductModerationUnavailableException,
  ProductMediaInvalidException,
  ProductNotFoundException,
  ProductReleaseUnavailableException,
  ProductSlugConflictException,
  ProductSuspendReasonRequiredException,
  ProductSuspendedException,
  ProductPackageAccessDeniedException,
  ProductPackageUnavailableException,
  ProductPackageDownloadUnavailableException,
} from './product.error.ts';
import type {
  CreateProductInputType,
  CreateProductOutputType,
  GetProductListInputType,
  GetProductListOutputType,
  ProductDetailOutputType,
  ProductMediaInputType,
  UpdateProductInputType,
  UpdateProductLifecycleInputType,
  UpdateProductModerationInputType,
  GetProductPackageDownloadInputType,
  GetProductPackageDownloadOutputType,
  ProductPackageFileMetadataType,
} from './product.model.ts';
import { ProductRepo } from './product.repo.ts';
import type { ProductMediaAuditRow } from './product.repo.ts';
import type { LockedProduct } from './product.repo.ts';
import { isProductProjectConflict, isProductSlugConflict } from './product.util.ts';

// Artwork reaches the Marketplace without a review, so the log has to name the actor.
const formatMediaAudit = (media: ProductMediaAuditRow[]) =>
  media.length === 0 ? '-' : media.map((item) => `${item.type}:${item.staticId}`).join(',');

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    @Inject(ProductRepo) private readonly productRepo: ProductRepo,
    @Inject(SharedUserRepository) private readonly sharedUserRepository: SharedUserRepository,
    @Inject(ProductAccessPolicy) private readonly productAccessPolicy: ProductAccessPolicy,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
    @Inject(ProductOfferService) private readonly productOfferService: ProductOfferService,
    @Inject(ProductReleaseManagementService)
    private readonly productReleaseService: ProductReleaseManagementService,
    @Inject(EntitlementService) private readonly entitlementService: EntitlementService,
    @Inject(StaticService) private readonly staticService: StaticService,
    @Inject(OBJECT_STORAGE_PROVIDER) private readonly storage: ObjectStorageProvider,
  ) {}

  async create({
    data,
    userId,
  }: {
    data: CreateProductInputType;
    userId: string;
  }): Promise<CreateProductOutputType> {
    const { publisherAccountId } = await this.productAccessPolicy.resolveCreateAccess(userId);

    const existing = await this.productRepo.getByProjectId({
      projectId: data.projectId,
      publisherAccountId,
    });
    if (existing) {
      this.logger.warn(
        'Product create rejected: Project already has a Product ' +
          `projectId=${data.projectId} productId=${existing.id} status=${existing.status}`,
      );
      // An archived Product never frees its Project for a second one (spec section 3).
      throw existing.status === ProductStatus.ARCHIVED
        ? ProductArchivedException
        : ProductAlreadyExistsException;
    }

    const project = await this.productRepo.findOwnedActiveProject({
      projectId: data.projectId,
      publisherAccountId,
    });
    if (!project) {
      this.logger.warn(
        'Product create rejected: Project missing, archived or owned by another Publisher ' +
          `projectId=${data.projectId} publisherAccountId=${publisherAccountId}`,
      );
      throw ProjectNotFoundException;
    }

    try {
      return await this.commitCreate({ data, publisherAccountId, userId });
    } catch (error) {
      // Business rejections raised inside the transaction are already logged.
      if (error instanceof HttpException) {
        throw error;
      }
      if (isUniqueConstraintPrismaError(error)) {
        if (isProductSlugConflict(error)) {
          this.logger.warn(
            `Product create rejected: slug already taken slug=${data.slug} projectId=${data.projectId}`,
          );
          throw ProductSlugConflictException;
        }
        if (isProductProjectConflict(error)) {
          // A concurrent create took the Project between the existence check and the insert.
          this.logger.warn(
            `Product create rejected: concurrent create took the Project projectId=${data.projectId}`,
          );
          throw ProductAlreadyExistsException;
        }
      }
      this.logger.error(
        `Product create failed projectId=${data.projectId} publisherAccountId=${publisherAccountId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  async update({
    id,
    data,
    userId,
    scopes,
  }: {
    id: string;
    data: UpdateProductInputType;
    userId: string;
    scopes: ActivePermissionScope[];
  }): Promise<MessageResType> {
    const { publisherAccountId } = await this.productAccessPolicy.resolveDraftSaveAccess(
      userId,
      scopes,
    );

    let result: { count: number; previousMedia?: ProductMediaAuditRow[] };
    try {
      result = await this.commitUpdate({ id, data, publisherAccountId, userId });
    } catch (error) {
      // Business rejections raised inside the transaction are already logged.
      if (error instanceof HttpException) {
        throw error;
      }
      if (isUniqueConstraintPrismaError(error) && isProductSlugConflict(error)) {
        this.logger.warn(
          `Product update rejected: slug already taken slug=${data.slug} productId=${id}`,
        );
        throw ProductSlugConflictException;
      }
      this.logger.error(
        `Product update failed productId=${id} publisherAccountId=${publisherAccountId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }

    if (result.count === 0) {
      await this.throwUpdateFailure({ id, publisherAccountId });
    }
    if (data.media !== undefined) {
      this.logger.log(
        `Product media replaced productId=${id} userId=${userId} ` +
          `before=${formatMediaAudit(result.previousMedia ?? [])} ` +
          `after=${formatMediaAudit(data.media)}`,
      );
    }
    return SUCCESS_RESPONSE;
  }

  async getList({
    query,
    userId,
    scopes,
  }: {
    query: GetProductListInputType;
    userId: string;
    scopes: ActivePermissionScope[];
  }): Promise<GetProductListOutputType> {
    const access = await this.productAccessPolicy.resolveReadAccess(userId, scopes);
    if (!access) {
      const { page, limit } = getPagination(query);
      return {
        items: [],
        totalItems: 0,
        page,
        limit,
        totalPages: 0,
      };
    }

    return this.productRepo.getList({ query, access });
  }

  async getDetail({
    id,
    userId,
    scopes,
  }: {
    id: string;
    userId: string;
    scopes: ActivePermissionScope[];
  }): Promise<ProductDetailOutputType> {
    const access = await this.productAccessPolicy.resolveReadAccess(userId, scopes);
    if (!access) {
      this.logger.warn(
        `Product read rejected: caller owns no Publisher account productId=${id} userId=${userId}`,
      );
      throw ProductNotFoundException;
    }

    const product = await this.productRepo.getDetailById({ id, access });
    if (!product) {
      this.logger.warn(
        `Product read rejected: not found or not visible to caller productId=${id} userId=${userId}`,
      );
      throw ProductNotFoundException;
    }
    return product;
  }

  @Transactional()
  async applyLifecycle({
    id,
    data,
    userId,
    scopes,
  }: {
    id: string;
    data: UpdateProductLifecycleInputType;
    userId: string;
    scopes: ActivePermissionScope[];
  }): Promise<MessageResType> {
    const access = await this.productAccessPolicy.resolveLifecycleAccess(userId, scopes);
    const product = await this.lockForLifecycle({ id, access });

    // A Publisher cannot undo an Admin decision.
    if (product.status === ProductStatus.SUSPENDED) {
      this.logger.warn(
        `Product lifecycle rejected: Error.ProductLifecycleUnavailable productId=${id}`,
      );
      throw ProductLifecycleUnavailableException;
    }

    if (data.action === ProductLifecycleAction.ARCHIVE) {
      await this.archive({ product, userId });
    } else if (data.action === ProductLifecycleAction.ACTIVATE) {
      await this.activate({ product, userId });
    } else {
      await this.reactivate({ product, userId, conflict: ProductCannotBeReactivatedException });
    }

    return SUCCESS_RESPONSE;
  }

  @Transactional()
  async applyModeration({
    id,
    data,
    userId,
    scopes,
  }: {
    id: string;
    data: UpdateProductModerationInputType;
    userId: string;
    scopes: ActivePermissionScope[];
  }): Promise<MessageResType> {
    const access = this.productAccessPolicy.resolveModerationAccess(scopes);
    const product = await this.lockForLifecycle({ id, access });

    // Admin moderation cannot undo a Publisher's archival.
    if (product.status === ProductStatus.ARCHIVED) {
      this.logger.warn(
        `Product moderation rejected: Error.ProductModerationUnavailable productId=${id}`,
      );
      throw ProductModerationUnavailableException;
    }

    if (data.action === ProductModerationAction.SUSPEND) {
      await this.suspend({ product, userId, reason: data.reason });
    } else {
      await this.reactivate({ product, userId, conflict: ProductCannotBeReactivatedException });
    }

    return SUCCESS_RESPONSE;
  }

  private async lockForLifecycle({
    id,
    access,
  }: {
    id: string;
    access: ProductAccess;
  }): Promise<LockedProduct> {
    const product = await this.productRepo.lockProduct({ id, access });
    if (!product) {
      this.logger.warn(`Product lifecycle rejected: not found productId=${id}`);
      throw ProductNotFoundException;
    }
    return product;
  }

  private async activate({
    product,
    userId,
  }: {
    product: LockedProduct;
    userId: string;
  }): Promise<void> {
    if (product.status === ProductStatus.ACTIVE) {
      return;
    }
    if (product.status !== ProductStatus.DRAFT) {
      this.logger.warn(
        `Product activate rejected: status=${product.status} productId=${product.id}`,
      );
      throw ProductCannotBeActivatedException;
    }

    await this.assertActivationReadiness(product);
    await this.productRepo.setStatus({ id: product.id, status: ProductStatus.ACTIVE, userId });
    // Only the first public configuration seeds the Offer window.
    await this.productOfferService.recordInitialPublicConfiguration({
      productId: product.id,
      occurredAt: product.transactionNow,
    });
  }

  private async archive({
    product,
    userId,
  }: {
    product: LockedProduct;
    userId: string;
  }): Promise<void> {
    if (product.status === ProductStatus.ARCHIVED) {
      return;
    }
    if (product.status !== ProductStatus.ACTIVE) {
      this.logger.warn(
        `Product archive rejected: status=${product.status} productId=${product.id}`,
      );
      throw ProductCannotBeArchivedException;
    }
    // Releases, Offers and the rate-limit history all survive an unlisting.
    await this.productRepo.setStatus({ id: product.id, status: ProductStatus.ARCHIVED, userId });
  }

  // Shared by the Publisher ARCHIVED -> ACTIVE and the Admin SUSPENDED -> ACTIVE paths:
  // both revalidate readiness and neither spends an Offer-change slot.
  private async reactivate({
    product,
    userId,
    conflict,
  }: {
    product: LockedProduct;
    userId: string;
    conflict: HttpException;
  }): Promise<void> {
    if (product.status === ProductStatus.ACTIVE) {
      return;
    }
    if (product.status === ProductStatus.DRAFT) {
      this.logger.warn(
        `Product reactivate rejected: Product is still a draft productId=${product.id}`,
      );
      throw conflict;
    }

    await this.assertActivationReadiness(product);
    await this.productRepo.setStatus({ id: product.id, status: ProductStatus.ACTIVE, userId });
  }

  private async suspend({
    product,
    userId,
    reason,
  }: {
    product: LockedProduct;
    userId: string;
    reason: string | undefined;
  }): Promise<void> {
    if (product.status === ProductStatus.SUSPENDED) {
      // Repeating a suspension keeps the original actor, timestamp and reason.
      return;
    }
    if (product.status !== ProductStatus.ACTIVE) {
      this.logger.warn(
        `Product suspend rejected: status=${product.status} productId=${product.id}`,
      );
      throw ProductCannotBeSuspendedException;
    }
    if (reason === undefined) {
      // Unreachable through the request schema, which requires a reason here.
      this.logger.warn(`Product suspend rejected: reason missing productId=${product.id}`);
      throw ProductSuspendReasonRequiredException;
    }

    await this.productRepo.suspend({ id: product.id, userId, reason });
  }

  // Release and Offer readiness are checked under the same Product lock as the status
  // change, so neither can be withdrawn between the check and the commit.
  private async assertActivationReadiness(product: LockedProduct): Promise<void> {
    if (!product.currentReleaseId) {
      this.logger.warn(`Product activation rejected: no current release productId=${product.id}`);
      throw ProductReleaseUnavailableException;
    }
    await this.productReleaseService.assertCurrentReleaseEligible({
      productId: product.id,
      releaseId: product.currentReleaseId,
    });
    await this.productOfferService.assertActivationReady(product.id);
  }

  @Transactional()
  private async commitCreate({
    data,
    publisherAccountId,
    userId,
  }: {
    data: CreateProductInputType;
    publisherAccountId: string;
    userId: string;
  }): Promise<CreateProductOutputType> {
    await this.assertMediaEligible(data.media);
    return this.productRepo.createWithMedia({ data, publisherAccountId, userId });
  }

  @Transactional()
  private async commitUpdate({
    id,
    data,
    publisherAccountId,
    userId,
  }: {
    id: string;
    data: UpdateProductInputType;
    publisherAccountId: string;
    userId: string;
  }): Promise<{ count: number; previousMedia?: ProductMediaAuditRow[] }> {
    if (data.media !== undefined) {
      await this.assertMediaEligible(data.media);
    }
    return this.productRepo.updateEditable({ id, data, publisherAccountId, userId });
  }

  private async assertMediaEligible(media: ProductMediaInputType[]) {
    if (media.length === 0) {
      return;
    }

    const staticIds = [...new Set(media.map((item) => item.staticId))];
    const eligibleCount = await this.productRepo.countEligibleMedia(staticIds);
    if (eligibleCount !== staticIds.length) {
      this.logger.warn(
        `Product media rejected: ${staticIds.length - eligibleCount} of ${staticIds.length} ` +
          'referenced statics are missing, deleted or not pipeline images',
      );
      throw ProductMediaInvalidException;
    }
  }

  private async throwUpdateFailure({
    id,
    publisherAccountId,
  }: {
    id: string;
    publisherAccountId: string;
  }): Promise<never> {
    const product = await this.productRepo.getById({
      id,
      access: { unrestricted: false, publisherAccountId },
    });
    if (!product) {
      this.logger.warn(
        `Product update rejected: not found or not owned productId=${id} publisherAccountId=${publisherAccountId}`,
      );
      throw ProductNotFoundException;
    }
    this.logger.warn(`Product update rejected: status=${product.status} productId=${id}`);
    if (product.status === ProductStatus.SUSPENDED) {
      throw ProductSuspendedException;
    }
    throw ProductArchivedException;
  }

  async getPackageDownload({
    productId,
    customerId,
    query,
  }: {
    productId: string;
    customerId: string;
    query: GetProductPackageDownloadInputType;
  }): Promise<GetProductPackageDownloadOutputType> {
    await this.assertPackageDownloadAccess(customerId, productId);
    const { release, file, packageHash } = await this.getPackageDownloadData(
      productId,
      query.releaseId,
    );
    const signedUrl = await this.createPackageDownloadUrl(file);
    return {
      package: { productId, releaseId: release.id, version: release.version, packageHash },
      fileName: file.originalFileName,
      packageSizeBytes: file.size.toString(),
      ...signedUrl,
    };
  }

  private async assertPackageDownloadAccess(customerId: string, productId: string): Promise<void> {
    const active = await this.sharedUserRepository.hasActiveCustomer(customerId);
    const access = active
      ? await this.entitlementService.checkUsage({ customerId, productId })
      : null;
    if (!access?.usable) {
      this.logger.error(
        `Product package download denied productId=${productId} customerId=${customerId} reason=${access?.reason ?? 'customer_ineligible'}`,
      );
      throw ProductPackageAccessDeniedException;
    }
  }

  private async getPackageDownloadData(productId: string, releaseId?: string) {
    const release = await this.productRepo.findDownloadRelease({ productId, releaseId });
    const hash = ProductPackageHash.safeParse(release?.packageHash);
    if (!release?.packageStaticId || !hash.success) {
      this.logger.error(
        `Product package unavailable productId=${productId} releaseId=${releaseId ?? 'current'} reason=release_or_hash_missing`,
      );
      throw ProductPackageUnavailableException;
    }
    const file = ProductPackageFileMetadata.safeParse(
      await this.staticService.getReservedFile(release.packageStaticId),
    );
    if (!file.success) {
      this.logger.error(
        `Product package unavailable productId=${productId} releaseId=${release.id} reason=invalid_file_metadata`,
      );
      throw ProductPackageUnavailableException;
    }
    return { release, file: file.data, packageHash: hash.data };
  }

  private async createPackageDownloadUrl(file: ProductPackageFileMetadataType) {
    try {
      if (!(await this.storage.objectExists(file.objectKey))) {
        this.logger.error(`Product package unavailable staticId=${file.id} reason=object_missing`);
        throw ProductPackageUnavailableException;
      }
      const expiresAt = new Date(
        Date.now() + envConfig.FILE_DOWNLOAD_URL_TTL * MILLISECONDS_PER_SECOND,
      );
      if (Number.isNaN(expiresAt.getTime())) throw new Error('Invalid download expiration');
      const downloadUrl = await this.storage.getDownloadUrl(file.objectKey, file.originalFileName);
      return { downloadUrl, expiresAt };
    } catch (error) {
      if (error === ProductPackageUnavailableException) throw error;
      this.logger.error(
        `Product package download failed operation=create_package_download_url staticId=${file.id} reason=${error instanceof Error ? error.name : 'UnknownError'}`,
      );
      throw ProductPackageDownloadUnavailableException;
    }
  }
}
