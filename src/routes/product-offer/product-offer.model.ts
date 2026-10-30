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
  ProductOfferLifecycleAction,
  ProductOfferType,
} from '../../shared/constants/product-offer.constant.ts';
import type { ProductOfferTypeValue } from '../../shared/constants/product-offer.constant.ts';
import { PaginationQuerySchema } from '../../shared/models/request.model.ts';
import { zBigIntAsNumber } from '../../shared/utils/zod.ts';

const PRICE_REQUIRED = 'Error.ProductOfferPriceRequired';
const PRICE_NOT_ALLOWED = 'Error.ProductOfferPriceNotAllowed';
const CURRENCY_REQUIRED = 'Error.ProductOfferCurrencyRequired';
const CURRENCY_NOT_ALLOWED = 'Error.ProductOfferCurrencyNotAllowed';
const DURATION_REQUIRED = 'Error.ProductOfferDurationRequired';
const DURATION_NOT_ALLOWED = 'Error.ProductOfferDurationNotAllowed';

// Integer minor unit: VND has no sub-unit, so one unit is one đồng.
const ProductOfferPriceInput = z.number().int().positive().nullable().optional();
const ProductOfferCurrencyInput = z.enum([PRODUCT_OFFER_CURRENCY_VND]).nullable().optional();
const ProductOfferDurationInput = z.number().int().positive().nullable().optional();

// The type/price/duration pairs the migration enforces with CHECK constraints.
const applyCommercialRules = (
  {
    type,
    priceMinor,
    currency,
    durationDays,
  }: {
    type: ProductOfferTypeValue;
    priceMinor?: number | null;
    currency?: string | null;
    durationDays?: number | null;
  },
  ctx: z.RefinementCtx,
) => {
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
};

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
  .superRefine(applyCommercialRules);

export const CreateProductOfferOutput = ProductOffer.pick({ id: true });

export const ProductOfferManagementOutput = ProductOffer.pick({
  id: true,
  productId: true,
  type: true,
  status: true,
  currency: true,
  durationDays: true,
  maxConcurrentDevices: true,
  usagePolicy: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  // The CHECK lets a FREE Offer store NULL, so reads must allow it.
  priceMinor: zBigIntAsNumber().nullable(),
});

export const ProductOfferIdParam = z
  .object({
    productId: z.uuid(),
    offerId: z.uuid(),
  })
  .strict();

// `type` is not editable: it decides which other columns are legal.
export const UpdateProductOfferInput = z
  .object({
    priceMinor: ProductOfferPriceInput,
    currency: ProductOfferCurrencyInput,
    durationDays: ProductOfferDurationInput,
    maxConcurrentDevices: z.number().int().positive().max(PRODUCT_OFFER_MAX_CONCURRENT_DEVICES),
    usagePolicy: ProductOfferUsagePolicy,
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export const UpdateProductOfferLifecycleInput = z
  .object({
    action: z.enum([ProductOfferLifecycleAction.ACTIVATE, ProductOfferLifecycleAction.DEACTIVATE]),
  })
  .strict();

// What the row must still satisfy once the patch is applied on top of it.
export const ProductOfferCommercialShape = z
  .object({
    type: ProductOfferTypeSchema,
    priceMinor: z.number().int().positive().nullable(),
    currency: z.string().nullable(),
    durationDays: z.number().int().positive().nullable(),
  })
  .superRefine(applyCommercialRules);

export const GetProductOfferListInput = PaginationQuerySchema.strict();

export const GetProductOfferListOutput = z.object({
  items: z.array(ProductOfferManagementOutput),
  totalItems: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

export type CreateProductOfferInputType = z.infer<typeof CreateProductOfferInput>;
export type UpdateProductOfferInputType = z.infer<typeof UpdateProductOfferInput>;
export type UpdateProductOfferLifecycleInputType = z.infer<typeof UpdateProductOfferLifecycleInput>;
export type CreateProductOfferOutputType = z.infer<typeof CreateProductOfferOutput>;
// z.input, not z.infer: priceMinor leaves Prisma as bigint and only becomes a number
// when the response interceptor serializes it.
export type GetProductOfferListInputType = z.infer<typeof GetProductOfferListInput>;
export type ProductOfferManagementOutputType = z.input<typeof ProductOfferManagementOutput>;
export type GetProductOfferListOutputType = z.input<typeof GetProductOfferListOutput>;
