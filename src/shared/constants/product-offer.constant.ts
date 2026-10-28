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

// The only value the design documents (a2matex-docs 04 §2): the Entitlement may run the
// current release and the older releases still supported. Add values here when the
// Release module defines them, never inline in a schema.
export const ProductOfferReleaseAccess = {
  CURRENT_AND_SUPPORTED: 'CURRENT_AND_SUPPORTED',
} as const;

export type ProductOfferReleaseAccessValue =
  (typeof ProductOfferReleaseAccess)[keyof typeof ProductOfferReleaseAccess];

export const PRODUCT_OFFER_USAGE_POLICY_SCHEMA_VERSION = '1.0';

// v1 sells in VND only. The column stays CHAR(3) so a second currency costs a migration
// of data, not of meaning.
export const PRODUCT_OFFER_CURRENCY_VND = 'VND';

export const PRODUCT_OFFER_MAX_CONCURRENT_DEVICES = 100;

// What an Offer grants when the publisher states nothing else. Matches the mock JSON in
// a2matex-docs 04 §2; every JSONB payload carries its own schema version.
export const DEFAULT_PRODUCT_OFFER_USAGE_POLICY = {
  schemaVersion: PRODUCT_OFFER_USAGE_POLICY_SCHEMA_VERSION,
  releaseAccess: ProductOfferReleaseAccess.CURRENT_AND_SUPPORTED,
  allowUpdates: true,
} as const;
