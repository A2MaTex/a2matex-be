import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProductStatus } from '../../shared/constants/product.constant.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { ProductAccessPolicy } from '../product/product-access.policy.ts';
import { ProductArchivedException, ProductNotFoundException } from '../product/product.error.ts';
import type {
  CreateProductOfferInputType,
  CreateProductOfferOutputType,
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

    const product = await this.productOfferRepo.getOwnedProduct({ productId, publisherAccountId });
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
}
