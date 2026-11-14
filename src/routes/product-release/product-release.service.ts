import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProductStatus } from '../../shared/constants/product.constant.ts';
import { ProductReleaseStatus } from '../../shared/constants/product-release.constant.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { SUCCESS_RESPONSE } from '../../shared/models/response.model.ts';
import type { MessageResType } from '../../shared/models/response.model.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import type { ProductAccess } from '../product/product-access.model.ts';
import { ProductAccessPolicy } from '../product/product-access.policy.ts';
import {
  ProductAccessDeniedException,
  ProductNotFoundException,
} from '../product/product.error.ts';
import {
  ProductReleaseDisableConflictException,
  ProductReleaseNotDisableableException,
  ProductReleaseNotFoundException,
  ProductReleaseNotSelectableException,
  ProductReleaseReplacementInvalidException,
  ProductReleaseReplacementRequiredException,
  ProductReleaseSelectionUnavailableException,
} from './product-release.error.ts';
import type {
  GetProductReleaseListInputType,
  GetProductReleaseListOutputType,
  ProductReleaseDetailOutputType,
  ProductReleaseLifecycleInputType,
} from './product-release.model.ts';
import { ProductReleaseManagementRepo } from './product-release.repo.ts';
import type { LockedProductRelease } from './product-release.repo.ts';

// Published, not disabled and holding a complete package.
function isSelectable(release: LockedProductRelease): boolean {
  return (
    release.status === ProductReleaseStatus.PUBLISHED &&
    release.disabledAt === null &&
    release.packageStaticId !== null &&
    release.packageHash !== null
  );
}

@Injectable()
export class ProductReleaseManagementService {
  private readonly logger = new Logger(ProductReleaseManagementService.name);

  constructor(
    @Inject(ProductReleaseManagementRepo) private readonly repo: ProductReleaseManagementRepo,
    @Inject(ProductAccessPolicy) private readonly productAccessPolicy: ProductAccessPolicy,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
  ) {}

  async getList({
    productId,
    query,
    userId,
    scopes,
  }: {
    productId: string;
    query: GetProductReleaseListInputType;
    userId: string;
    scopes: ActivePermissionScope[];
  }): Promise<GetProductReleaseListOutputType> {
    const product = await this.getVisibleProduct({ productId, userId, scopes });
    const { page, limit } = getPagination(query);
    return this.repo.getList({
      productId,
      currentReleaseId: product.currentReleaseId,
      query: { page, limit },
    });
  }

  async getDetail({
    productId,
    releaseId,
    userId,
    scopes,
  }: {
    productId: string;
    releaseId: string;
    userId: string;
    scopes: ActivePermissionScope[];
  }): Promise<ProductReleaseDetailOutputType> {
    const product = await this.getVisibleProduct({ productId, userId, scopes });
    const release = await this.repo.getDetail({
      productId,
      releaseId,
      currentReleaseId: product.currentReleaseId,
      includeFailureCode: scopes.includes(null),
    });
    if (!release) {
      this.logger.warn(
        `Product release read rejected: not found productId=${productId} releaseId=${releaseId}`,
      );
      throw ProductReleaseNotFoundException;
    }
    return release;
  }

  async selectCurrent({
    productId,
    releaseId,
    userId,
    scopes,
  }: {
    productId: string;
    releaseId: string;
    userId: string;
    scopes: ActivePermissionScope[];
  }): Promise<MessageResType> {
    const access = await this.productAccessPolicy.resolveReleaseSelectionAccess(userId, scopes);
    await this.commitSelectCurrent({ productId, releaseId, userId, access });
    return SUCCESS_RESPONSE;
  }

  async applyLifecycle({
    productId,
    releaseId,
    data,
    userId,
    scopes,
  }: {
    productId: string;
    releaseId: string;
    data: ProductReleaseLifecycleInputType;
    userId: string;
    scopes: ActivePermissionScope[];
  }): Promise<MessageResType> {
    // Disable is Admin-only. The guard already requires a null-scope permission, so
    // an OWN-only caller reaching here is refused rather than trusted.
    if (!scopes.includes(null)) {
      throw ProductAccessDeniedException;
    }
    await this.commitDisable({ productId, releaseId, data, userId });
    return SUCCESS_RESPONSE;
  }

  private async getVisibleProduct({
    productId,
    userId,
    scopes,
  }: {
    productId: string;
    userId: string;
    scopes: ActivePermissionScope[];
  }) {
    const access = await this.productAccessPolicy.resolveReadAccess(userId, scopes);
    const product = access ? await this.repo.getVisibleProduct({ id: productId, access }) : null;
    if (!product) {
      this.logger.warn(
        `Product release read rejected: product not found or not visible productId=${productId} userId=${userId}`,
      );
      throw ProductNotFoundException;
    }
    return product;
  }

  @Transactional()
  private async commitSelectCurrent({
    productId,
    releaseId,
    userId,
    access,
  }: {
    productId: string;
    releaseId: string;
    userId: string;
    access: ProductAccess;
  }): Promise<void> {
    // Lock order: Product, selected ProductRelease, currently selected ProductRelease.
    const product = await this.repo.lockProduct({ id: productId, access });
    if (!product) {
      this.logger.warn(`Product release select rejected: product not found productId=${productId}`);
      throw ProductNotFoundException;
    }

    const allowedStatuses: string[] = access.unrestricted
      ? [ProductStatus.ACTIVE, ProductStatus.SUSPENDED]
      : [ProductStatus.ACTIVE];
    if (!allowedStatuses.includes(product.status)) {
      this.logger.warn(
        `Product release select rejected: product status=${product.status} productId=${productId}`,
      );
      throw ProductReleaseSelectionUnavailableException;
    }

    const release = await this.repo.lockRelease({ id: releaseId, productId });
    if (!release) {
      this.logger.warn(
        `Product release select rejected: release not found productId=${productId} releaseId=${releaseId}`,
      );
      throw ProductReleaseNotFoundException;
    }
    if (product.currentReleaseId === release.id) {
      return;
    }
    if (!isSelectable(release)) {
      this.logger.warn(
        `Product release select rejected: release status=${release.status} not selectable releaseId=${releaseId}`,
      );
      throw ProductReleaseNotSelectableException;
    }

    if (product.currentReleaseId) {
      await this.repo.lockRelease({ id: product.currentReleaseId, productId });
    }
    await this.repo.setCurrentRelease({ productId, currentReleaseId: release.id, userId });
  }

  @Transactional()
  private async commitDisable({
    productId,
    releaseId,
    data,
    userId,
  }: {
    productId: string;
    releaseId: string;
    data: ProductReleaseLifecycleInputType;
    userId: string;
  }): Promise<void> {
    // Lock order: Product, target ProductRelease, replacement ProductRelease.
    const product = await this.repo.lockProduct({ id: productId, access: { unrestricted: true } });
    if (!product) {
      this.logger.warn(
        `Product release disable rejected: product not found productId=${productId}`,
      );
      throw ProductNotFoundException;
    }

    const release = await this.repo.lockRelease({ id: releaseId, productId });
    if (!release) {
      this.logger.warn(
        `Product release disable rejected: release not found productId=${productId} releaseId=${releaseId}`,
      );
      throw ProductReleaseNotFoundException;
    }

    if (release.status === ProductReleaseStatus.DISABLED) {
      if (release.disabledReason === data.reason) {
        return;
      }
      this.logger.warn(
        `Product release disable rejected: already disabled with a different reason releaseId=${releaseId}`,
      );
      throw ProductReleaseDisableConflictException;
    }
    if (release.status !== ProductReleaseStatus.PUBLISHED) {
      this.logger.warn(
        `Product release disable rejected: status=${release.status} releaseId=${releaseId}`,
      );
      throw ProductReleaseNotDisableableException;
    }

    if (product.currentReleaseId === release.id) {
      if (product.status === ProductStatus.ACTIVE) {
        const replacementId = data.replacementReleaseId;
        if (!replacementId) {
          this.logger.warn(
            `Product release disable rejected: replacement required releaseId=${releaseId}`,
          );
          throw ProductReleaseReplacementRequiredException;
        }
        const replacement =
          replacementId === release.id
            ? null
            : await this.repo.lockRelease({ id: replacementId, productId });
        if (!replacement || !isSelectable(replacement)) {
          this.logger.warn(
            `Product release disable rejected: replacement invalid releaseId=${releaseId} replacementReleaseId=${replacementId}`,
          );
          throw ProductReleaseReplacementInvalidException;
        }
        await this.repo.setCurrentRelease({ productId, currentReleaseId: replacement.id, userId });
      } else {
        await this.repo.setCurrentRelease({ productId, currentReleaseId: null, userId });
      }
    }

    await this.repo.disable({ id: release.id, reason: data.reason, userId });
  }
}
