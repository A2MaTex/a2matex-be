import { Inject, Injectable } from '@nestjs/common';
import { ProductLifecycleAction, ProductStatus } from '../../shared/constants/product.constant.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import { SUCCESS_RESPONSE } from '../../shared/models/response.model.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import { isUniqueConstraintPrismaError } from '../../shared/utils/prisma.ts';
import { ProjectNotFoundException } from '../project/project.error.ts';
import type { ProductAccess } from './product-access.model.ts';
import { ProductAccessPolicy } from './product-access.policy.ts';
import {
  ProductArchivedException,
  ProductCannotBeArchivedException,
  ProductCannotBeReactivatedException,
  ProductCannotBeSuspendedException,
  ProductMediaInvalidException,
  ProductNotFoundException,
  ProductReleaseUnavailableException,
  ProductSlugConflictException,
  ProductSuspendedException,
} from './product.error.ts';
import type {
  CreateProductInputType,
  GetProductListInputType,
  GetProductListOutputType,
  ProductManagementOutputType,
  ProductMediaInputType,
  UpdateProductInputType,
  UpdateProductLifecycleInputType,
} from './product.model.ts';
import { ProductRepo } from './product.repo.ts';
import { isProductProjectConflict, isProductSlugConflict } from './product.util.ts';

export type CreateProductResult = {
  product: ProductManagementOutputType;
  created: boolean;
};

@Injectable()
export class ProductService {
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
  }): Promise<CreateProductResult> {
    const { publisherAccountId } = await this.productAccessPolicy.resolveCreateAccess(userId);

    const existing = await this.productRepo.getByProjectId({
      projectId: data.projectId,
      publisherAccountId,
    });
    if (existing) {
      return { product: this.assertResolvable(existing), created: false };
    }

    const project = await this.productRepo.findOwnedActiveProject({
      projectId: data.projectId,
      publisherAccountId,
    });
    if (!project) {
      throw ProjectNotFoundException;
    }

    try {
      const product = await this.commitCreate({ data, publisherAccountId, userId });
      return { product, created: true };
    } catch (error) {
      if (!isUniqueConstraintPrismaError(error)) {
        throw error;
      }
      if (isProductSlugConflict(error)) {
        throw ProductSlugConflictException;
      }
      if (!isProductProjectConflict(error)) {
        throw error;
      }

      // A concurrent create took the Project first; the unique constraint is the
      // resolution point, so resolve the winner rather than report a conflict.
      const winner = await this.productRepo.getByProjectId({
        projectId: data.projectId,
        publisherAccountId,
      });
      if (!winner) {
        throw error;
      }
      return { product: this.assertResolvable(winner), created: false };
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
  }): Promise<ProductManagementOutputType> {
    const { publisherAccountId } = await this.productAccessPolicy.resolveDraftSaveAccess(
      userId,
      scopes,
    );

    let updated: ProductManagementOutputType | null;
    try {
      updated = await this.commitUpdate({ id, data, publisherAccountId, userId });
    } catch (error) {
      if (isUniqueConstraintPrismaError(error) && isProductSlugConflict(error)) {
        throw ProductSlugConflictException;
      }
      throw error;
    }

    if (!updated) {
      return this.throwUpdateFailure({ id, publisherAccountId });
    }
    return updated;
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
      throw ProductNotFoundException;
    }

    const product = await this.productRepo.getById({ id, access });
    if (!product) {
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
  }) {
    const access = await this.productAccessPolicy.resolveLifecycleAccess(
      userId,
      scopes,
      data.action,
    );

    if (data.action === ProductLifecycleAction.ARCHIVE) {
      return this.archive({ id, access, userId });
    }
    if (data.action === ProductLifecycleAction.SUSPEND) {
      const { reason } = data;
      if (reason === undefined) {
        // Unreachable through the request schema, which requires a reason here.
        // Refusing beats writing a suspension record with no stated cause.
        throw ProductCannotBeSuspendedException;
      }
      return this.suspend({ id, access, userId, reason });
    }
    return this.reactivate({ id, access, userId });
  }

  private async archive({
    id,
    access,
    userId,
  }: {
    id: string;
    access: ProductAccess;
    userId: string;
  }) {
    const result = await this.productRepo.archiveDraft({ id, access, userId });
    if (result.count === 0) {
      await this.assertLifecycleOutcome({
        id,
        access,
        idempotentStatus: ProductStatus.ARCHIVED,
        conflict: ProductCannotBeArchivedException,
      });
    }
    return SUCCESS_RESPONSE;
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
  }) {
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
    return SUCCESS_RESPONSE;
  }

  private async reactivate({
    id,
    access,
    userId,
  }: {
    id: string;
    access: ProductAccess;
    userId: string;
  }) {
    const result = await this.productRepo.reactivateSuspended({ id, access, userId });
    if (result.count === 0) {
      const product = await this.productRepo.getById({ id, access });
      if (!product) {
        throw ProductNotFoundException;
      }
      if (product.status === ProductStatus.ACTIVE) {
        return SUCCESS_RESPONSE;
      }
      if (product.status !== ProductStatus.SUSPENDED) {
        throw ProductCannotBeReactivatedException;
      }
      // Suspended but the release pointer failed the predicate.
      throw ProductReleaseUnavailableException;
    }
    return SUCCESS_RESPONSE;
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
    conflict: Error;
  }) {
    const product = await this.productRepo.getById({ id, access });
    if (!product) {
      throw ProductNotFoundException;
    }
    if (product.status !== idempotentStatus) {
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
  }): Promise<ProductManagementOutputType> {
    await this.assertMediaEligible({ media: data.media, publisherAccountId });
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
  }): Promise<ProductManagementOutputType | null> {
    if (data.media !== undefined) {
      await this.assertMediaEligible({ media: data.media, publisherAccountId });
    }
    return this.productRepo.updateEditable({ id, data, publisherAccountId, userId });
  }

  private async assertMediaEligible({
    media,
    publisherAccountId,
  }: {
    media: ProductMediaInputType[];
    publisherAccountId: string;
  }) {
    if (media.length === 0) {
      return;
    }

    const staticIds = [...new Set(media.map((item) => item.staticId))];
    const eligibleCount = await this.productRepo.countEligibleMedia({
      staticIds,
      publisherAccountId,
    });
    if (eligibleCount !== staticIds.length) {
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
      throw ProductNotFoundException;
    }
    if (product.status === ProductStatus.SUSPENDED) {
      throw ProductSuspendedException;
    }
    throw ProductArchivedException;
  }

  private assertResolvable(product: ProductManagementOutputType) {
    if (product.status === ProductStatus.ARCHIVED) {
      throw ProductArchivedException;
    }
    return product;
  }
}
