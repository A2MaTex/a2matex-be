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

/**
 * Versioned per db_design/README.md: every JSONB column is validated at the API
 * boundary against a schema that carries its own version.
 */
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
  usagePolicy: ProductOfferUsagePolicy,
  createdById: z.uuid(),
  updatedById: z.uuid().nullable(),
});

export type ProductOfferUsagePolicyType = z.infer<typeof ProductOfferUsagePolicy>;
export type ProductOfferEntityType = z.infer<typeof ProductOffer>;
