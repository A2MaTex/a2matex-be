import { createZodDto } from 'nestjs-zod';
import {
  GetPublicProductListInput,
  GetPublicProductListOutput,
  PublicProductDetailOutput,
  PublicProductSummaryOutput,
} from './marketplace-product.model.ts';

export class GetPublicProductListInputDTO extends createZodDto(GetPublicProductListInput) {}

export class GetPublicProductListOutputDTO extends createZodDto(GetPublicProductListOutput) {}

export class PublicProductSummaryOutputDTO extends createZodDto(PublicProductSummaryOutput) {}

export class PublicProductDetailOutputDTO extends createZodDto(PublicProductDetailOutput) {}
