import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { MessageResDTO } from '../../shared/dtos/response.dto.ts';
import { ActivePermissionScopes } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import {
  CreateProductInputDTO,
  CreateProductOutputDTO,
  GetProductListInputDTO,
  GetProductListOutputDTO,
  ProductIdParamDTO,
  ProductDetailOutputDTO,
  UpdateProductInputDTO,
  UpdateProductLifecycleInputDTO,
  UpdateProductModerationInputDTO,
  GetProductPackageDownloadInputDTO,
  GetProductPackageDownloadOutputDTO,
  ProductPackageProductParamDTO,
} from './product.dto.ts';
import { ProductService } from './product.service.ts';

@ApiTags('Products')
@ApiBearerAuth('access-token')
@Controller('products')
export class ProductController {
  constructor(@Inject(ProductService) private readonly productService: ProductService) {}

  @Post()
  @ZodResponse({ type: CreateProductOutputDTO })
  create(@Body() body: CreateProductInputDTO, @ActiveUser('userId') userId: string) {
    return this.productService.create({ data: body, userId });
  }

  @Get()
  @ZodResponse({ type: GetProductListOutputDTO })
  getList(
    @Query() query: GetProductListInputDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.productService.getList({ query, userId, scopes });
  }

  @Get(':productId/package-download')
  @Header('Cache-Control', 'no-store')
  @ZodResponse({ type: GetProductPackageDownloadOutputDTO })
  getPackageDownload(
    @Param() params: ProductPackageProductParamDTO,
    @Query() query: GetProductPackageDownloadInputDTO,
    @ActiveUser('userId') customerId: string,
  ) {
    return this.productService.getPackageDownload({
      productId: params.productId,
      customerId,
      query,
    });
  }

  @Get(':productId')
  @ZodResponse({ type: ProductDetailOutputDTO })
  getDetail(
    @Param() params: ProductIdParamDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.productService.getDetail({ id: params.productId, userId, scopes });
  }

  @Patch(':productId')
  @ZodResponse({ type: MessageResDTO })
  update(
    @Param() params: ProductIdParamDTO,
    @Body() body: UpdateProductInputDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.productService.update({ id: params.productId, data: body, userId, scopes });
  }

  // Publisher visibility only. Suspension lives on the Admin moderation route so an
  // owner can never undo it.
  @Put(':productId/lifecycle')
  @ZodResponse({ type: MessageResDTO })
  applyLifecycle(
    @Param() params: ProductIdParamDTO,
    @Body() body: UpdateProductLifecycleInputDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.productService.applyLifecycle({ id: params.productId, data: body, userId, scopes });
  }

  @Put(':productId/moderation')
  @ZodResponse({ type: MessageResDTO })
  applyModeration(
    @Param() params: ProductIdParamDTO,
    @Body() body: UpdateProductModerationInputDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.productService.applyModeration({
      id: params.productId,
      data: body,
      userId,
      scopes,
    });
  }
}
