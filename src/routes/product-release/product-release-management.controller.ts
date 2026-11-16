import { Body, Controller, Get, Inject, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActivePermissionScopes } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { MessageResDTO } from '../../shared/dtos/response.dto.ts';
import {
  GetProductReleaseListInputDTO,
  GetProductReleaseListOutputDTO,
  ProductReleaseDetailOutputDTO,
  ProductReleaseLifecycleInputDTO,
  ProductReleaseParamDTO,
  ProductReleaseProductParamDTO,
  SelectCurrentProductReleaseInputDTO,
} from './product-release.dto.ts';
import { ProductReleaseManagementService } from './product-release.service.ts';

// Literal paths: the permission seed reads them from the decorators. `releases/current`
// has two segments after the Product, so it cannot be captured by `releases/:releaseId`
// (GET) or `releases/:releaseId/lifecycle` (three segments).
@ApiTags('ProductRelease')
@ApiBearerAuth('access-token')
@Controller('products')
export class ProductReleaseManagementController {
  constructor(
    @Inject(ProductReleaseManagementService)
    private readonly service: ProductReleaseManagementService,
  ) {}

  @Get(':productId/releases')
  @ZodResponse({ type: GetProductReleaseListOutputDTO })
  getList(
    @Param() params: ProductReleaseProductParamDTO,
    @Query() query: GetProductReleaseListInputDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.service.getList({ productId: params.productId, query, userId, scopes });
  }

  @Put(':productId/releases/current')
  @ZodResponse({ type: MessageResDTO })
  selectCurrent(
    @Param() params: ProductReleaseProductParamDTO,
    @Body() body: SelectCurrentProductReleaseInputDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.service.selectCurrent({
      productId: params.productId,
      releaseId: body.releaseId,
      userId,
      scopes,
    });
  }

  @Get(':productId/releases/:releaseId')
  @ZodResponse({ type: ProductReleaseDetailOutputDTO })
  getDetail(
    @Param() params: ProductReleaseParamDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.service.getDetail({
      productId: params.productId,
      releaseId: params.releaseId,
      userId,
      scopes,
    });
  }

  @Put(':productId/releases/:releaseId/lifecycle')
  @ZodResponse({ type: MessageResDTO })
  applyLifecycle(
    @Param() params: ProductReleaseParamDTO,
    @Body() body: ProductReleaseLifecycleInputDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.service.applyLifecycle({
      productId: params.productId,
      releaseId: params.releaseId,
      data: body,
      userId,
      scopes,
    });
  }
}
