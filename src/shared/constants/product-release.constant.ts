export const ProductReleaseStatus = {
  BUILDING: 'BUILDING',
  PUBLISHED: 'PUBLISHED',
  BUILD_FAILED: 'BUILD_FAILED',
  DISABLED: 'DISABLED',
} as const;

export type ProductReleaseStatusType =
  (typeof ProductReleaseStatus)[keyof typeof ProductReleaseStatus];

export const ProductReleaseLifecycleAction = {
  DISABLE: 'DISABLE',
} as const;

export const PRODUCT_RELEASE_DISABLE_REASON_MAX_LENGTH = 2_000;
