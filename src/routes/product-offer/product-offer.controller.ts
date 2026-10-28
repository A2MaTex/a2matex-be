import { Body, Controller, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActivePermissionScopes } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { ProductIdParamDTO } from '../product/product.dto.ts';
import { CreateProductOfferInputDTO, CreateProductOfferOutputDTO } from './product-offer.dto.ts';
import { ProductOfferService } from './product-offer.service.ts';

@ApiTags('Product Offers')
@ApiBearerAuth('access-token')
@Controller('products/:productId/offers')
export class ProductOfferController {
  constructor(
    @Inject(ProductOfferService) private readonly productOfferService: ProductOfferService,
  ) {}

  @Post()
  @ZodResponse({ type: CreateProductOfferOutputDTO })
  create(
    @Param() params: ProductIdParamDTO,
    @Body() body: CreateProductOfferInputDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.productOfferService.create({
      productId: params.productId,
      data: body,
      userId,
      scopes,
    });
  }
}
