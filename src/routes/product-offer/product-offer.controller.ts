import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActivePermissionScopes } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { MessageResDTO } from '../../shared/dtos/response.dto.ts';
import { ProductIdParamDTO } from '../product/product.dto.ts';
import {
  CreateProductOfferInputDTO,
  CreateProductOfferOutputDTO,
  GetProductOfferListInputDTO,
  GetProductOfferListOutputDTO,
  ProductOfferIdParamDTO,
  UpdateProductOfferInputDTO,
} from './product-offer.dto.ts';
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

  @Get()
  @ZodResponse({ type: GetProductOfferListOutputDTO })
  getList(
    @Param() params: ProductIdParamDTO,
    @Query() query: GetProductOfferListInputDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.productOfferService.getList({
      productId: params.productId,
      query,
      userId,
      scopes,
    });
  }

  @Patch(':offerId')
  @ZodResponse({ type: MessageResDTO })
  update(
    @Param() params: ProductOfferIdParamDTO,
    @Body() body: UpdateProductOfferInputDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.productOfferService.update({
      productId: params.productId,
      offerId: params.offerId,
      data: body,
      userId,
      scopes,
    });
  }
}
