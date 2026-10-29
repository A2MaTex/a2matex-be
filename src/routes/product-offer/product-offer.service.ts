import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProductStatus } from '../../shared/constants/product.constant.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { ProductAccessPolicy } from '../product/product-access.policy.ts';
import { ProductArchivedException, ProductNotFoundException } from '../product/product.error.ts';
import type {
  CreateProductOfferInputType,
  CreateProductOfferOutputType,
  GetProductOfferListInputType,
  GetProductOfferListOutputType,
} from './product-offer.model.ts';
import { ProductOfferRepo } from './product-offer.repo.ts';

@Injectable()
export class ProductOfferService {
  private readonly logger = new Logger(ProductOfferService.name);

  constructor(
    @Inject(ProductOfferRepo) private readonly productOfferRepo: ProductOfferRepo,
    @Inject(ProductAccessPolicy) private readonly productAccessPolicy: ProductAccessPolicy,
  ) {}

  async create({
    productId,
    data,
    userId,
    scopes,
  }: {
    productId: string;
    data: CreateProductOfferInputType;
    userId: string;
    scopes: ActivePermissionScope[];
  }): Promise<CreateProductOfferOutputType> {
    const { publisherAccountId } = await this.productAccessPolicy.resolveDraftSaveAccess(
      userId,
      scopes,
    );

    // Writing an Offer is never an unrestricted action: it is pinned to the caller's
    // own Publisher account even when the caller also holds a wider permission.
    const product = await this.productOfferRepo.getProduct({
      productId,
      access: { unrestricted: false, publisherAccountId },
    });
    if (!product) {
      this.logger.warn(
        'Product Offer create rejected: Product missing or owned by another Publisher ' +
          `productId=${productId} publisherAccountId=${publisherAccountId}`,
      );
      throw ProductNotFoundException;
    }
    // A suspended Product may still gather Offers — only activating one puts it on sale,
    // and that is decided again at activation. An archived Product is final.
    if (product.status === ProductStatus.ARCHIVED) {
      this.logger.warn(`Product Offer create rejected: Product archived productId=${productId}`);
      throw ProductArchivedException;
    }

    try {
      return await this.productOfferRepo.create({ productId, data, userId });
    } catch (error) {
      // Nothing below the service logs an unexpected failure: CatchEverythingFilter
      // turns it into a bare 500 without a trace of what happened.
      this.logger.error(
        `Product Offer create failed productId=${productId} type=${data.type}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  async getList({
    productId,
    query,
    userId,
    scopes,
  }: {
    productId: string;
    query: GetProductOfferListInputType;
    userId: string;
    scopes: ActivePermissionScope[];
  }): Promise<GetProductOfferListOutputType> {
    const access = await this.productAccessPolicy.resolveReadAccess(userId, scopes);
    if (!access) {
      this.logger.warn(
        `Product Offer read rejected: caller owns no Publisher account productId=${productId} userId=${userId}`,
      );
      throw ProductNotFoundException;
    }

    // Reading the Offers of a Product nobody can show the caller must not reveal that
    // the Product exists, so ownership is checked before the Offers are read.
    const product = await this.productOfferRepo.getProduct({ productId, access });
    if (!product) {
      this.logger.warn(
        `Product Offer read rejected: Product not found or not visible productId=${productId} userId=${userId}`,
      );
      throw ProductNotFoundException;
    }

    return this.productOfferRepo.getListByProduct({ productId, query });
  }
}
