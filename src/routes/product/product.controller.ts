import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import { ActivePermissionScopes } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import {
  CreateProductInputDTO,
  GetProductListInputDTO,
  GetProductListOutputDTO,
  ProductIdParamDTO,
  ProductManagementOutputDTO,
  UpdateProductInputDTO,
} from './product.dto.ts';
import { ProductService } from './product.service.ts';

@ApiTags('Products')
@ApiBearerAuth('access-token')
@Controller('products')
export class ProductController {
  constructor(@Inject(ProductService) private readonly productService: ProductService) {}

  // 201 on create; resolving an existing Product answers 200 instead, which the
  // response envelope picks up from the Express status.
  @Post()
  @ZodResponse({ type: ProductManagementOutputDTO })
  async create(
    @Body() body: CreateProductInputDTO,
    @ActiveUser('userId') userId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { product, created } = await this.productService.create({ data: body, userId });
    if (!created) {
      response.status(HttpStatus.OK);
    }
    return product;
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

  @Get(':productId')
  @ZodResponse({ type: ProductManagementOutputDTO })
  getDetail(
    @Param() params: ProductIdParamDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.productService.getDetail({ id: params.productId, userId, scopes });
  }

  @Patch(':productId')
  @ZodResponse({ type: ProductManagementOutputDTO })
  update(
    @Param() params: ProductIdParamDTO,
    @Body() body: UpdateProductInputDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.productService.update({ id: params.productId, data: body, userId, scopes });
  }
}
