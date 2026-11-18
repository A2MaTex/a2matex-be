import { z } from 'zod';
import { ProductOffer, ProductOfferTypeSchema } from '../../entities/product-offer.model.ts';
import envConfig from '../../shared/config.ts';
import { ProductOfferType } from '../../shared/constants/product-offer.constant.ts';
import type { ProductOfferTypeValue } from '../../shared/constants/product-offer.constant.ts';
import { zBigIntAsString } from '../../shared/utils/zod.ts';

// The stable codes the failure table names; the frontend translates by key.
const INVALID = 'Error.ProductOfferInvalid';
const LIMIT_EXCEEDED = 'Error.ProductOfferLimitExceeded';
const DUPLICATE = 'Error.ProductOfferDuplicate';

// A decimal string, not a number: the configured maximum is past Number.MAX_SAFE_INTEGER.
// The pattern alone rejects signs, decimal points, exponents and whitespace.
const PriceAmountInput = z
  .string()
  .regex(/^\d{1,19}$/, INVALID)
  .transform((value) => BigInt(value))
  .refine((value) => value <= envConfig.PRODUCT_OFFER_MAX_PRICE_AMOUNT, INVALID);

const DurationDaysInput = z
  .number()
  .int(INVALID)
  .positive(INVALID)
  .max(envConfig.PRODUCT_OFFER_MAX_DURATION_DAYS, INVALID)
  .nullable();

export const ProductOfferInput = z
  .object({
    type: ProductOfferTypeSchema,
    priceAmount: PriceAmountInput,
    durationDays: DurationDaysInput,
  })
  .strict()
  .superRefine((offer, ctx) => {
    if (offer.type !== ProductOfferType.SUBSCRIPTION) {
      return;
    }
    // A subscription that is free or permanent would never expire into a repurchase.
    if (offer.priceAmount <= 0n) {
      ctx.addIssue({ code: 'custom', message: INVALID, path: ['priceAmount'] });
    }
    if (offer.durationDays === null) {
      ctx.addIssue({ code: 'custom', message: INVALID, path: ['durationDays'] });
    }
  });

type ProductOfferInputShape = {
  type: ProductOfferTypeValue;
  priceAmount: bigint;
  durationDays: number | null;
};

// Type, then finite duration ascending, then permanent last. Input order carries no
// persistence or presentation meaning.
const canonicalize = (offers: ProductOfferInputShape[]) =>
  [...offers].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type < right.type ? -1 : 1;
    }
    if (left.durationDays === right.durationDays) {
      return 0;
    }
    if (left.durationDays === null) {
      return 1;
    }
    if (right.durationDays === null) {
      return -1;
    }
    return left.durationDays - right.durationDays;
  });

export const naturalKeyOf = (offer: Pick<ProductOfferInputShape, 'type' | 'durationDays'>) =>
  `${offer.type}:${offer.durationDays ?? 'PERMANENT'}`;

export const ReplaceProductOffersInput = z
  .object({
    offers: z.array(ProductOfferInput).max(envConfig.PRODUCT_OFFER_MAX_COUNT, LIMIT_EXCEEDED),
  })
  .strict()
  // Price is not part of the identity, so two rows sharing type and duration are the same
  // offer sent twice rather than two offers.
  .superRefine(({ offers }, ctx) => {
    const seen = new Set<string>();
    offers.forEach((offer, index) => {
      const key = naturalKeyOf(offer);
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          message: DUPLICATE,
          path: ['offers', index, 'durationDays'],
        });
      }
      seen.add(key);
    });
  })
  .transform(({ offers }) => ({ offers: canonicalize(offers) }));

export const ProductOfferOutput = ProductOffer.pick({
  id: true,
  type: true,
  durationDays: true,
}).extend({
  priceAmount: zBigIntAsString(),
});

export type ReplaceProductOffersInputType = z.infer<typeof ReplaceProductOffersInput>;
export type ProductOfferInputType = z.infer<typeof ProductOfferInput>;
// z.input, not z.infer: priceAmount leaves Prisma as a bigint and only becomes a string
// when the response interceptor serializes it.
export type ProductOfferOutputType = z.input<typeof ProductOfferOutput>;
