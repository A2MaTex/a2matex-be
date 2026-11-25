import { createZodDto } from 'nestjs-zod';
import {
  CreateProductInput,
  CreateProductOutput,
  GetProductListInput,
  GetProductListOutput,
  ProductDetailOutput,
  ProductIdParam,
  ProductManagementOutput,
  UpdateProductInput,
  UpdateProductLifecycleInput,
  UpdateProductModerationInput,
  GetProductPackageDownloadInput,
  GetProductPackageDownloadOutput,
  ProductPackageProductParam,
} from './product.model.ts';

export class ProductIdParamDTO extends createZodDto(ProductIdParam) {}

export class CreateProductInputDTO extends createZodDto(CreateProductInput) {}

export class CreateProductOutputDTO extends createZodDto(CreateProductOutput) {}

export class UpdateProductInputDTO extends createZodDto(UpdateProductInput) {}

export class GetProductListInputDTO extends createZodDto(GetProductListInput) {}

export class GetProductListOutputDTO extends createZodDto(GetProductListOutput) {}

export class ProductManagementOutputDTO extends createZodDto(ProductManagementOutput) {}

export class ProductDetailOutputDTO extends createZodDto(ProductDetailOutput) {}

export class UpdateProductLifecycleInputDTO extends createZodDto(UpdateProductLifecycleInput) {}

export class UpdateProductModerationInputDTO extends createZodDto(UpdateProductModerationInput) {}

export class ProductPackageProductParamDTO extends createZodDto(ProductPackageProductParam) {}
export class GetProductPackageDownloadInputDTO extends createZodDto(
  GetProductPackageDownloadInput,
) {}
export class GetProductPackageDownloadOutputDTO extends createZodDto(
  GetProductPackageDownloadOutput,
) {}
