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

export const PRODUCT_RELEASE_ENCRYPTION_ALGORITHM = 'AES-256-GCM';

// COMPLETED: the release is PUBLISHED (also when it already was, so a redelivery is a no-op).
// INVALID:   permanent, retrying cannot help (missing/unapproved Submission, disabled release).
// RETRY:     failure or a superseded candidate; no published result has been confirmed yet.
export const BuildOutcome = {
  COMPLETED: 'COMPLETED',
  RETRY: 'RETRY',
  INVALID: 'INVALID',
} as const;

export const BuildFailureCode = {
  NO_LONGER_ELIGIBLE: 'NO_LONGER_ELIGIBLE',
  SUBMISSION_NOT_FOUND: 'SUBMISSION_NOT_FOUND',
  NOT_APPROVE_YET: 'NOT_APPROVE_YET',
  DISABLE_SUBMISSION: 'DISABLE_SUBMISSION',
  NOT_PASS_SCAN: 'NOT_PASS_SCAN',
  MISSING_RUNTIMEIR_CONTENTHASH: 'MISSING_RUNTIMEIR_CONTENTHASH',
  ALREADY_PUBLISHED: 'ALREADY_PUBLISHED',
  FAILED: 'FAILED',
  DISABLE_RELEASE: 'DISABLE_RELEASE',
} as const;

export type BuildOutcomeType = (typeof BuildOutcome)[keyof typeof BuildOutcome];
