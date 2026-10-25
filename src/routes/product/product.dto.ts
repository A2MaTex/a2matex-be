import { createZodDto } from 'nestjs-zod';
import { CreateProductInput, ProductIdParam, ProductManagementOutput } from './product.model.ts';

export class ProductIdParamDTO extends createZodDto(ProductIdParam) {}

export class CreateProductInputDTO extends createZodDto(CreateProductInput) {}

export class ProductManagementOutputDTO extends createZodDto(ProductManagementOutput) {}
