import {
  EDITOR_GRAPH_IDENTIFIER_MAX_LENGTH,
  EDITOR_GRAPH_MAX_DIAGNOSTICS,
} from './workflow-validation.constant.ts';

export const SubmissionStatus = {
  PENDING_SCAN: 'PENDING_SCAN',
  READY_FOR_REVIEW: 'READY_FOR_REVIEW',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

export type SubmissionStatusType = (typeof SubmissionStatus)[keyof typeof SubmissionStatus];

export const SubmissionScanStatus = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  ERROR: 'ERROR',
} as const;

export type SubmissionScanStatusType =
  (typeof SubmissionScanStatus)[keyof typeof SubmissionScanStatus];

export const SubmissionSelfReviewCode = {
  PRODUCT_PRESENTATION_MATCHES_BEHAVIOR: 'PRODUCT_PRESENTATION_MATCHES_BEHAVIOR',
  WORKFLOW_TESTED: 'WORKFLOW_TESTED',
  NO_RAW_CREDENTIALS: 'NO_RAW_CREDENTIALS',
  NO_ASSET_REFERENCES: 'NO_ASSET_REFERENCES',
  RELEASE_INFORMATION_ACCURATE: 'RELEASE_INFORMATION_ACCURATE',
} as const;

export type SubmissionSelfReviewCodeType =
  (typeof SubmissionSelfReviewCode)[keyof typeof SubmissionSelfReviewCode];

export const SUBMISSION_SELF_REVIEW_CODES = Object.values(SubmissionSelfReviewCode);

export const SubmissionFindingSeverity = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
} as const;

export type SubmissionFindingSeverityType =
  (typeof SubmissionFindingSeverity)[keyof typeof SubmissionFindingSeverity];

// Every stored snapshot carries this; the API accepts unversioned input.
export const SUBMISSION_SNAPSHOT_SCHEMA_VERSION = 1;

export const SUBMISSION_RELEASE_VERSION_MAX_LENGTH = 100;
export const SUBMISSION_CHANGELOG_MAX_LENGTH = 5_000;
export const SUBMISSION_PURPOSE_MAX_LENGTH = 2_000;
export const SUBMISSION_TEST_INSTRUCTIONS_MAX_LENGTH = 5_000;
export const SUBMISSION_KNOWN_LIMITATION_MAX_LENGTH = 500;
export const SUBMISSION_KNOWN_LIMITATIONS_MAX_ITEMS = 20;

export const SUBMISSION_IDEMPOTENCY_KEY_MAX_LENGTH = 255;
export const SUBMISSION_REQUEST_HASH_LENGTH = 64;
export const SUBMISSION_SCANNER_VERSION_MAX_LENGTH = 100;

// Finding count reuses the validation diagnostic cap so the two engines cannot drift.
export const SUBMISSION_SCAN_MAX_FINDINGS = EDITOR_GRAPH_MAX_DIAGNOSTICS;
export const SUBMISSION_FINDING_CODE_MAX_LENGTH = 100;
export const SUBMISSION_FINDING_MESSAGE_MAX_LENGTH = 1_000;
export const SUBMISSION_FINDING_NODE_ID_MAX_LENGTH = EDITOR_GRAPH_IDENTIFIER_MAX_LENGTH;
export const SUBMISSION_FINDING_DETAILS_MAX_BYTES = 2_048;
export const SUBMISSION_SCAN_RESULT_MAX_BYTES = 65_536;

// The create transaction holds the Product lock while WorkflowRevision canonicalises
// and hashes up to 2 MiB, so a second create on the same Product waits for the first
// before doing its own build. Prisma's 5s default is too tight for that queue.
export const SUBMISSION_CREATE_TX_TIMEOUT_MS = 15_000;
export const SUBMISSION_CREATE_TX_MAX_WAIT_MS = 5_000;

export const SUBMISSION_SCAN_MESSAGE_TYPE = 'submission.scan.requested.v1';
export const SUBMISSION_SCAN_MESSAGE_ID_PREFIX = 'submission-scan';
export const SUBMISSION_SCAN_CONSUMER_GROUP_ID = 'submission-scan-v1';
export const SUBMISSION_SCAN_MAX_ATTEMPTS = 5;
export const SUBMISSION_SCAN_RETRY_DELAY_MS = 5_000;
