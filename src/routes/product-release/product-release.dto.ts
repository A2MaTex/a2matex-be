import { createZodDto } from 'nestjs-zod';
import {
  GetProductReleaseListInput,
  GetProductReleaseListOutput,
  ProductReleaseDetailOutput,
  ProductReleaseLifecycleInput,
  ProductReleaseParam,
  ProductReleaseProductParam,
  SelectCurrentProductReleaseInput,
} from './product-release.model.ts';

export class ProductReleaseProductParamDTO extends createZodDto(ProductReleaseProductParam) {}

export class ProductReleaseParamDTO extends createZodDto(ProductReleaseParam) {}

export class GetProductReleaseListInputDTO extends createZodDto(GetProductReleaseListInput) {}

export class GetProductReleaseListOutputDTO extends createZodDto(GetProductReleaseListOutput) {}

export class ProductReleaseDetailOutputDTO extends createZodDto(ProductReleaseDetailOutput) {}

export class SelectCurrentProductReleaseInputDTO extends createZodDto(
  SelectCurrentProductReleaseInput,
) {}

export class ProductReleaseLifecycleInputDTO extends createZodDto(ProductReleaseLifecycleInput) {}
