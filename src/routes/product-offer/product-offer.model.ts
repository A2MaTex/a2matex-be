import { z } from 'zod';
import {
  ProductOffer,
  ProductOfferTypeSchema,
  ProductOfferUsagePolicy,
} from '../../entities/product-offer.model.ts';
import {
  DEFAULT_PRODUCT_OFFER_USAGE_POLICY,
  PRODUCT_OFFER_CURRENCY_VND,
  PRODUCT_OFFER_MAX_CONCURRENT_DEVICES,
  ProductOfferType,
} from '../../shared/constants/product-offer.constant.ts';

const PRICE_REQUIRED = 'Error.ProductOfferPriceRequired';
const PRICE_NOT_ALLOWED = 'Error.ProductOfferPriceNotAllowed';
const CURRENCY_REQUIRED = 'Error.ProductOfferCurrencyRequired';
const CURRENCY_NOT_ALLOWED = 'Error.ProductOfferCurrencyNotAllowed';
const DURATION_REQUIRED = 'Error.ProductOfferDurationRequired';
const DURATION_NOT_ALLOWED = 'Error.ProductOfferDurationNotAllowed';

// Money is an integer minor unit (db_design/README.md). VND has no sub-unit, so one
// unit here is one đồng.
const ProductOfferPriceInput = z.number().int().positive().nullable().optional();
const ProductOfferCurrencyInput = z.enum([PRODUCT_OFFER_CURRENCY_VND]).nullable().optional();
const ProductOfferDurationInput = z.number().int().positive().nullable().optional();

export const CreateProductOfferInput = z
  .object({
    type: ProductOfferTypeSchema,
    priceMinor: ProductOfferPriceInput,
    currency: ProductOfferCurrencyInput,
    durationDays: ProductOfferDurationInput,
    maxConcurrentDevices: z
      .number()
      .int()
      .positive()
      .max(PRODUCT_OFFER_MAX_CONCURRENT_DEVICES)
      .default(1),
    usagePolicy: ProductOfferUsagePolicy.optional().default(DEFAULT_PRODUCT_OFFER_USAGE_POLICY),
  })
  .strict()
  // The same pairs the migration enforces with CHECK constraints. Answering 422 with a
  // field path here beats letting Postgres answer 500 with a constraint name.
  .superRefine(({ type, priceMinor, currency, durationDays }, ctx) => {
    const isFree = type === ProductOfferType.FREE;
    const isSubscription = type === ProductOfferType.SUBSCRIPTION;

    if (isFree && priceMinor !== undefined && priceMinor !== null) {
      ctx.addIssue({ code: 'custom', message: PRICE_NOT_ALLOWED, path: ['priceMinor'] });
    }
    if (!isFree && (priceMinor === undefined || priceMinor === null)) {
      ctx.addIssue({ code: 'custom', message: PRICE_REQUIRED, path: ['priceMinor'] });
    }
    if (isFree && currency !== undefined && currency !== null) {
      ctx.addIssue({ code: 'custom', message: CURRENCY_NOT_ALLOWED, path: ['currency'] });
    }
    if (!isFree && (currency === undefined || currency === null)) {
      ctx.addIssue({ code: 'custom', message: CURRENCY_REQUIRED, path: ['currency'] });
    }
    if (isSubscription && (durationDays === undefined || durationDays === null)) {
      ctx.addIssue({ code: 'custom', message: DURATION_REQUIRED, path: ['durationDays'] });
    }
    if (!isSubscription && durationDays !== undefined && durationDays !== null) {
      ctx.addIssue({ code: 'custom', message: DURATION_NOT_ALLOWED, path: ['durationDays'] });
    }
  });

export const CreateProductOfferOutput = ProductOffer.pick({ id: true });

export type CreateProductOfferInputType = z.infer<typeof CreateProductOfferInput>;
export type CreateProductOfferOutputType = z.infer<typeof CreateProductOfferOutput>;
