export const ProductStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  ARCHIVED: 'ARCHIVED',
} as const;

export type ProductStatusType = (typeof ProductStatus)[keyof typeof ProductStatus];

// A Product may enter the release pipeline (submit, review, approve) only in these
// statuses. Submission and Review must agree on the list, so it lives here once.
export const RELEASABLE_PRODUCT_STATUSES: ProductStatusType[] = [
  ProductStatus.DRAFT,
  ProductStatus.ACTIVE,
];

export const ProductMediaType = {
  ICON: 'ICON',
  COVER: 'COVER',
  GALLERY: 'GALLERY',
} as const;

export type ProductMediaTypeValue = (typeof ProductMediaType)[keyof typeof ProductMediaType];

// Publisher owns visibility, Admin owns moderation. A Publisher can never undo a
// suspension and Admin can never undo a Publisher's archival.
export const ProductLifecycleAction = {
  ACTIVATE: 'ACTIVATE',
  ARCHIVE: 'ARCHIVE',
  REACTIVATE: 'REACTIVATE',
} as const;

export type ProductLifecycleActionType =
  (typeof ProductLifecycleAction)[keyof typeof ProductLifecycleAction];

export const ProductModerationAction = {
  SUSPEND: 'SUSPEND',
  REACTIVATE: 'REACTIVATE',
} as const;

export type ProductModerationActionType =
  (typeof ProductModerationAction)[keyof typeof ProductModerationAction];

export const PRODUCT_NAME_MAX_LENGTH = 255;
export const PRODUCT_SLUG_MAX_LENGTH = 255;
export const PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH = 500;
export const PRODUCT_MEDIA_ALT_TEXT_MAX_LENGTH = 500;
export const PRODUCT_STATUS_REASON_MAX_LENGTH = 2_000;

// Lowercase words joined by single hyphens. Input is lowercased before this runs.
export const PRODUCT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Public Marketplace reads share the default page size with every other list; only the
// upper bound is specific to an unauthenticated route.
export const PUBLIC_PRODUCT_LIST_MAX_LIMIT = 100;
export const PUBLIC_PRODUCT_SEARCH_MAX_LENGTH = 100;

export const PRODUCT_PACKAGE_MAX_BYTES = 4 * 1024 * 1024;
export const PRODUCT_PACKAGE_FILENAME_MAX_BYTES = 255;
export const PRODUCT_PACKAGE_CONTENT_TYPE = 'application/zip';
export const PRODUCT_PACKAGE_HASH_HEX_LENGTH = 64;
export const PRODUCT_PACKAGE_HASH_PATTERN = /^[a-f0-9]{64}$/;
// Rejecting control bytes is intentional for portable download filenames.
// oxlint-disable-next-line no-control-regex
export const PRODUCT_PACKAGE_FILENAME_PATTERN = /^[^<>:"/\\|?*\u0000-\u001f\u007f]+\.a2m$/u;
// With Unicode mode, valid surrogate pairs are one code point; this matches only lone halves.
export const PRODUCT_PACKAGE_INVALID_UNICODE_PATTERN = /[\uD800-\uDFFF]/u;
export const PRODUCT_PACKAGE_RESERVED_NAME_PATTERN =
  /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:[ .]|$)/i;
export const MILLISECONDS_PER_SECOND = 1_000;
