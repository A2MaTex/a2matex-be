import { z } from 'zod';
import {
  PRODUCT_OFFER_USAGE_POLICY_SCHEMA_VERSION,
  ProductOfferReleaseAccess,
  ProductOfferStatus,
  ProductOfferType,
} from '../shared/constants/product-offer.constant.ts';
import { Base } from './base.model.ts';

export const ProductOfferTypeSchema = z.enum([
  ProductOfferType.FREE,
  ProductOfferType.ONE_TIME,
  ProductOfferType.SUBSCRIPTION,
]);

export const ProductOfferStatusSchema = z.enum([
  ProductOfferStatus.DRAFT,
  ProductOfferStatus.ACTIVE,
  ProductOfferStatus.INACTIVE,
]);

// What the column can hold: the CHECK only guarantees a JSON object.
export const ProductOfferUsagePolicyValue = z.record(z.string(), z.json());

// The stricter shape writes must satisfy, versioned per db_design/README.md.
export const ProductOfferUsagePolicy = z
  .object({
    schemaVersion: z.literal(PRODUCT_OFFER_USAGE_POLICY_SCHEMA_VERSION),
    releaseAccess: z.enum([ProductOfferReleaseAccess.CURRENT_AND_SUPPORTED]),
    allowUpdates: z.boolean(),
  })
  .strict();

export const ProductOffer = Base.extend({
  productId: z.uuid(),
  type: ProductOfferTypeSchema,
  status: ProductOfferStatusSchema,
  currency: z.string().nullable(),
  priceMinor: z.bigint().nullable(),
  durationDays: z.number().int().nullable(),
  maxConcurrentDevices: z.number().int(),
  usagePolicy: ProductOfferUsagePolicyValue,
  createdById: z.uuid(),
  updatedById: z.uuid().nullable(),
});

// Not `ProductOfferType`: that name is already the enum constant in shared/constants.
export type ProductOfferUsagePolicyType = z.infer<typeof ProductOfferUsagePolicy>;
export type ProductOfferEntityType = z.infer<typeof ProductOffer>;
