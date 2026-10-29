import { createZodDto } from 'nestjs-zod';
import {
  CreateProductOfferInput,
  CreateProductOfferOutput,
  GetProductOfferListInput,
  GetProductOfferListOutput,
} from './product-offer.model.ts';

export class CreateProductOfferInputDTO extends createZodDto(CreateProductOfferInput) {}

export class CreateProductOfferOutputDTO extends createZodDto(CreateProductOfferOutput) {}

export class GetProductOfferListInputDTO extends createZodDto(GetProductOfferListInput) {}

export class GetProductOfferListOutputDTO extends createZodDto(GetProductOfferListOutput) {}
