import { Inject, Injectable } from '@nestjs/common';
import { ProductStatus } from '../../shared/constants/product.constant.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import { isUniqueConstraintPrismaError } from '../../shared/utils/prisma.ts';
import { ProjectNotFoundException } from '../project/project.error.ts';
import { ProductAccessPolicy } from './product-access.policy.ts';
import {
  ProductArchivedException,
  ProductMediaInvalidException,
  ProductNotFoundException,
  ProductSlugConflictException,
  ProductSuspendedException,
} from './product.error.ts';
import type {
  CreateProductInputType,
  ProductManagementOutputType,
  ProductMediaInputType,
  UpdateProductInputType,
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
    const product = await this.productRepo.getOwnedById({ id, publisherAccountId });
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
