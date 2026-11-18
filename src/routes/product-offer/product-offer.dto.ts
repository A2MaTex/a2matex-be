import { createZodDto } from 'nestjs-zod';
import { ReplaceProductOffersInput } from './product-offer.model.ts';

export class ReplaceProductOffersInputDTO extends createZodDto(ReplaceProductOffersInput) {}
