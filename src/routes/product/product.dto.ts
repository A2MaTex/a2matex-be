import { createZodDto } from 'nestjs-zod';
import {
  CreateProductInput,
  GetProductListInput,
  GetProductListOutput,
  ProductIdParam,
  ProductManagementOutput,
  UpdateProductInput,
  UpdateProductLifecycleInput,
} from './product.model.ts';

export class ProductIdParamDTO extends createZodDto(ProductIdParam) {}

export class CreateProductInputDTO extends createZodDto(CreateProductInput) {}

export class UpdateProductInputDTO extends createZodDto(UpdateProductInput) {}

export class GetProductListInputDTO extends createZodDto(GetProductListInput) {}

export class GetProductListOutputDTO extends createZodDto(GetProductListOutput) {}

export class ProductManagementOutputDTO extends createZodDto(ProductManagementOutput) {}

export class UpdateProductLifecycleInputDTO extends createZodDto(UpdateProductLifecycleInput) {}
