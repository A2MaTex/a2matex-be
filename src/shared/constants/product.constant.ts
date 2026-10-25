export const ProductStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  ARCHIVED: 'ARCHIVED',
} as const;

export type ProductStatusType = (typeof ProductStatus)[keyof typeof ProductStatus];

export const ProductMediaType = {
  ICON: 'ICON',
  COVER: 'COVER',
  GALLERY: 'GALLERY',
} as const;

export type ProductMediaTypeValue = (typeof ProductMediaType)[keyof typeof ProductMediaType];

export const PRODUCT_NAME_MAX_LENGTH = 255;
export const PRODUCT_SLUG_MAX_LENGTH = 255;
export const PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH = 500;
export const PRODUCT_MEDIA_ALT_TEXT_MAX_LENGTH = 500;
export const PRODUCT_STATUS_REASON_MAX_LENGTH = 2_000;

// Lowercase words joined by single hyphens. Input is lowercased before this runs.
export const PRODUCT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
