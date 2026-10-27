import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { ProductLifecycleAction, ProductStatus } from '../../shared/constants/product.constant.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import { SUCCESS_RESPONSE } from '../../shared/models/response.model.ts';
import type { MessageResType } from '../../shared/models/response.model.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import { isUniqueConstraintPrismaError } from '../../shared/utils/prisma.ts';
import { ProjectNotFoundException } from '../project/project.error.ts';
import type { ProductAccess } from './product-access.model.ts';
import { ProductAccessPolicy } from './product-access.policy.ts';
import {
  ProductAlreadyExistsException,
  ProductArchivedException,
  ProductCannotBeArchivedException,
  ProductCannotBeReactivatedException,
  ProductCannotBeSuspendedException,
  ProductMediaInvalidException,
  ProductNotFoundException,
  ProductReleaseUnavailableException,
  ProductSlugConflictException,
  ProductSuspendReasonRequiredException,
  ProductSuspendedException,
} from './product.error.ts';
import type {
  CreateProductInputType,
  CreateProductOutputType,
  GetProductListInputType,
  GetProductListOutputType,
  ProductManagementOutputType,
  ProductMediaInputType,
  UpdateProductInputType,
  UpdateProductLifecycleInputType,
} from './product.model.ts';
import { ProductRepo } from './product.repo.ts';
import { isProductProjectConflict, isProductSlugConflict } from './product.util.ts';

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    @Inject(ProductRepo) private readonly productRepo: ProductRepo,
    @Inject(ProductAccessPolicy) private readonly productAccessPolicy: ProductAccessPolicy,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
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

    let result: { count: number };
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
  }): Promise<ProductManagementOutputType> {
    const access = await this.productAccessPolicy.resolveReadAccess(userId, scopes);
    if (!access) {
      this.logger.warn(
        `Product read rejected: caller owns no Publisher account productId=${id} userId=${userId}`,
      );
      throw ProductNotFoundException;
    }

    const product = await this.productRepo.getById({ id, access });
    if (!product) {
      this.logger.warn(
        `Product read rejected: not found or not visible to caller productId=${id} userId=${userId}`,
      );
      throw ProductNotFoundException;
    }
    return product;
  }

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
    const access = await this.productAccessPolicy.resolveLifecycleAccess(
      userId,
      scopes,
      data.action,
    );

    if (data.action === ProductLifecycleAction.ARCHIVE) {
      await this.archive({ id, access, userId });
    } else if (data.action === ProductLifecycleAction.SUSPEND) {
      const { reason } = data;
      if (reason === undefined) {
        // Unreachable through the request schema, which requires a reason here.
        // Refusing beats writing a suspension record with no stated cause.
        this.logger.warn(
          `Product suspend rejected: reason missing productId=${id} userId=${userId}`,
        );
        throw ProductSuspendReasonRequiredException;
      }
      await this.suspend({ id, access, userId, reason });
    } else {
      await this.reactivate({ id, access, userId });
    }
    return SUCCESS_RESPONSE;
  }

  private async archive({
    id,
    access,
    userId,
  }: {
    id: string;
    access: ProductAccess;
    userId: string;
  }): Promise<void> {
    const result = await this.productRepo.archiveDraft({ id, access, userId });
    if (result.count === 0) {
      await this.assertLifecycleOutcome({
        id,
        access,
        idempotentStatus: ProductStatus.ARCHIVED,
        conflict: ProductCannotBeArchivedException,
      });
    }
  }

  private async suspend({
    id,
    access,
    userId,
    reason,
  }: {
    id: string;
    access: ProductAccess;
    userId: string;
    reason: string;
  }): Promise<void> {
    const result = await this.productRepo.suspendActive({ id, access, userId, reason });
    if (result.count === 0) {
      // Repeating a suspension keeps the original actor, timestamp and reason.
      await this.assertLifecycleOutcome({
        id,
        access,
        idempotentStatus: ProductStatus.SUSPENDED,
        conflict: ProductCannotBeSuspendedException,
      });
    }
  }

  private async reactivate({
    id,
    access,
    userId,
  }: {
    id: string;
    access: ProductAccess;
    userId: string;
  }): Promise<void> {
    const result = await this.productRepo.reactivateSuspended({ id, access, userId });
    if (result.count > 0) {
      return;
    }

    const product = await this.productRepo.getById({ id, access });
    if (!product) {
      this.logger.warn(`Product reactivate rejected: not found productId=${id}`);
      throw ProductNotFoundException;
    }
    if (product.status === ProductStatus.ACTIVE) {
      // Idempotent: already where the caller wants it.
      return;
    }
    if (product.status !== ProductStatus.SUSPENDED) {
      this.logger.warn(
        `Product reactivate rejected: status=${product.status} is not SUSPENDED productId=${id}`,
      );
      throw ProductCannotBeReactivatedException;
    }
    // Suspended but the release pointer failed the predicate.
    this.logger.warn(`Product reactivate rejected: no current release productId=${id}`);
    throw ProductReleaseUnavailableException;
  }

  // One authorization-safe read separates idempotent completion from not found and
  // from an invalid source status, without revealing cross-owner data.
  private async assertLifecycleOutcome({
    id,
    access,
    idempotentStatus,
    conflict,
  }: {
    id: string;
    access: ProductAccess;
    idempotentStatus: ProductManagementOutputType['status'];
    conflict: HttpException;
  }) {
    const product = await this.productRepo.getById({ id, access });
    if (!product) {
      this.logger.warn(`Product lifecycle rejected: not found productId=${id}`);
      throw ProductNotFoundException;
    }
    if (product.status !== idempotentStatus) {
      this.logger.warn(
        `Product lifecycle rejected: status=${product.status} cannot become ${idempotentStatus} productId=${id}`,
      );
      throw conflict;
    }
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
  }): Promise<{ count: number }> {
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
}
