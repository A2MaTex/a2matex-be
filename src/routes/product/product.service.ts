import { Inject, Injectable } from '@nestjs/common';
import { ProductStatus } from '../../shared/constants/product.constant.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import { isUniqueConstraintPrismaError } from '../../shared/utils/prisma.ts';
import { ProjectNotFoundException } from '../project/project.error.ts';
import { PublisherAccessPolicy } from '../publisher/publisher-access.policy.ts';
import {
  ProductArchivedException,
  ProductMediaInvalidException,
  ProductSlugConflictException,
} from './product.error.ts';
import type { CreateProductInputType, ProductManagementOutputType } from './product.model.ts';
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
    @Inject(PublisherAccessPolicy) private readonly publisherAccessPolicy: PublisherAccessPolicy,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
  ) {}

  async create({
    data,
    userId,
  }: {
    data: CreateProductInputType;
    userId: string;
  }): Promise<CreateProductResult> {
    const { publisherAccountId } = await this.publisherAccessPolicy.assertActivePublisher(userId);

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

  private async assertMediaEligible({
    media,
    publisherAccountId,
  }: {
    media: CreateProductInputType['media'];
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

  private assertResolvable(product: ProductManagementOutputType) {
    if (product.status === ProductStatus.ARCHIVED) {
      throw ProductArchivedException;
    }
    return product;
  }
}
