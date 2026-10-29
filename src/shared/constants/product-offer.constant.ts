export const ProductOfferType = {
  FREE: 'FREE',
  ONE_TIME: 'ONE_TIME',
  SUBSCRIPTION: 'SUBSCRIPTION',
} as const;

export type ProductOfferTypeValue = (typeof ProductOfferType)[keyof typeof ProductOfferType];

export const ProductOfferStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;

export type ProductOfferStatusValue = (typeof ProductOfferStatus)[keyof typeof ProductOfferStatus];

// The only value the design documents (a2matex-docs 04 §2).
export const ProductOfferReleaseAccess = {
  CURRENT_AND_SUPPORTED: 'CURRENT_AND_SUPPORTED',
} as const;

export type ProductOfferReleaseAccessValue =
  (typeof ProductOfferReleaseAccess)[keyof typeof ProductOfferReleaseAccess];

export const PRODUCT_OFFER_USAGE_POLICY_SCHEMA_VERSION = '1.0';

// v1 sells in VND only; the column stays CHAR(3) for a later currency.
export const PRODUCT_OFFER_CURRENCY_VND = 'VND';

export const PRODUCT_OFFER_MAX_CONCURRENT_DEVICES = 100;

// Default policy when the publisher states nothing (a2matex-docs 04 §2).
export const DEFAULT_PRODUCT_OFFER_USAGE_POLICY = {
  schemaVersion: PRODUCT_OFFER_USAGE_POLICY_SCHEMA_VERSION,
  releaseAccess: ProductOfferReleaseAccess.CURRENT_AND_SUPPORTED,
  allowUpdates: true,
} as const;
