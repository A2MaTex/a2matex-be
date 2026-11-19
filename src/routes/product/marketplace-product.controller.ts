import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { IsPublic } from '../../shared/decorators/auth.decorator.ts';
import {
  GetPublicProductListInputDTO,
  GetPublicProductListOutputDTO,
  PublicProductDetailOutputDTO,
} from './marketplace-product.dto.ts';
import { MarketplaceProductService } from './marketplace-product.service.ts';
import { ProductIdParamDTO } from './product.dto.ts';

// Public reads keep their own routes: the permission-scoped Product controller answers
// for management and must never serve the Marketplace projection.
@ApiTags('Marketplace Products')
@Controller('marketplace/products')
export class MarketplaceProductController {
  constructor(
    @Inject(MarketplaceProductService)
    private readonly marketplaceProductService: MarketplaceProductService,
  ) {}

  @Get()
  @IsPublic()
  @ZodResponse({ type: GetPublicProductListOutputDTO })
  getList(@Query() query: GetPublicProductListInputDTO) {
    return this.marketplaceProductService.getList(query);
  }

  @Get(':productId')
  @IsPublic()
  @ZodResponse({ type: PublicProductDetailOutputDTO })
  getDetail(@Param() params: ProductIdParamDTO) {
    return this.marketplaceProductService.getDetail(params.productId);
  }
}
