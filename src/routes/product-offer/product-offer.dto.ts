import { createZodDto } from 'nestjs-zod';
import { CreateProductOfferInput, CreateProductOfferOutput } from './product-offer.model.ts';

export class CreateProductOfferInputDTO extends createZodDto(CreateProductOfferInput) {}

export class CreateProductOfferOutputDTO extends createZodDto(CreateProductOfferOutput) {}
