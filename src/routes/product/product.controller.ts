import { Body, Controller, HttpStatus, Inject, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { CreateProductInputDTO, ProductManagementOutputDTO } from './product.dto.ts';
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
}
