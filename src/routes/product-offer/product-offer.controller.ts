import { Body, Controller, Inject, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActivePermissionScopes } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { MessageResDTO } from '../../shared/dtos/response.dto.ts';
import { ProductIdParamDTO } from '../product/product.dto.ts';
import { ReplaceProductOffersInputDTO } from './product-offer.dto.ts';
import { ProductOfferService } from './product-offer.service.ts';

@ApiTags('Product Offers')
@ApiBearerAuth('access-token')
@Controller('products/:productId/offers')
export class ProductOfferController {
  constructor(
    @Inject(ProductOfferService) private readonly productOfferService: ProductOfferService,
  ) {}

  // Full replacement of the Product's offer collection. Product detail is what the
  // frontend reloads afterwards for the newest rows and their generated IDs.
  @Put()
  @ZodResponse({ type: MessageResDTO })
  replace(
    @Param() params: ProductIdParamDTO,
    @Body() body: ReplaceProductOffersInputDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.productOfferService.replace({
      productId: params.productId,
      data: body,
      userId,
      scopes,
    });
  }
}
