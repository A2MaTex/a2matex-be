import { Inject, Injectable } from '@nestjs/common';
import type {
  GetPublicProductListInputType,
  GetPublicProductListOutputType,
  PublicProductDetailOutputType,
} from './marketplace-product.model.ts';
import { MarketplaceProductRepo } from './marketplace-product.repo.ts';
import { ProductNotFoundException } from './product.error.ts';

@Injectable()
export class MarketplaceProductService {
  constructor(
    @Inject(MarketplaceProductRepo) private readonly marketplaceProductRepo: MarketplaceProductRepo,
  ) {}

  getList(query: GetPublicProductListInputType): Promise<GetPublicProductListOutputType> {
    return this.marketplaceProductRepo.getPublicList(query);
  }

  // Ineligible and missing answer the same way: the route must not reveal draft,
  // suspended, archived, blocked-Publisher or disabled-release state.
  async getDetail(productId: string): Promise<PublicProductDetailOutputType> {
    const product = await this.marketplaceProductRepo.getPublicDetail(productId);
    if (!product) {
      throw ProductNotFoundException;
    }
    return product;
  }
}
