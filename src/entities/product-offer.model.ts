import { z } from 'zod';
import { ProductOfferType } from '../shared/constants/product-offer.constant.ts';
import { BaseWithUserFields } from './base.model.ts';

export const ProductOfferTypeSchema = z.enum([
  ProductOfferType.ONE_TIME,
  ProductOfferType.SUBSCRIPTION,
]);

export const ProductOffer = BaseWithUserFields.extend({
  productId: z.uuid(),
  type: ProductOfferTypeSchema,
  priceAmount: z.bigint(),
  durationDays: z.number().int().nullable(),
});

export type ProductOfferEntityType = z.infer<typeof ProductOffer>;
