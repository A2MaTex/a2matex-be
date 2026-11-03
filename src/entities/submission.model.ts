import { z } from 'zod';
import {
  PRODUCT_MEDIA_ALT_TEXT_MAX_LENGTH,
  ProductMediaType,
} from '../shared/constants/product.constant.ts';
import {
  SUBMISSION_CHANGELOG_MAX_LENGTH,
  SUBMISSION_FINDING_CODE_MAX_LENGTH,
  SUBMISSION_FINDING_DETAILS_MAX_BYTES,
  SUBMISSION_FINDING_MESSAGE_MAX_LENGTH,
  SUBMISSION_FINDING_NODE_ID_MAX_LENGTH,
  SUBMISSION_IDEMPOTENCY_KEY_MAX_LENGTH,
  SUBMISSION_KNOWN_LIMITATION_MAX_LENGTH,
  SUBMISSION_KNOWN_LIMITATIONS_MAX_ITEMS,
  SUBMISSION_PURPOSE_MAX_LENGTH,
  SUBMISSION_RELEASE_VERSION_MAX_LENGTH,
  SUBMISSION_REQUEST_HASH_LENGTH,
  SUBMISSION_SCAN_MAX_FINDINGS,
  SUBMISSION_SCAN_RESULT_MAX_BYTES,
  SUBMISSION_SCANNER_VERSION_MAX_LENGTH,
  SUBMISSION_SELF_REVIEW_CODES,
  SUBMISSION_SNAPSHOT_SCHEMA_VERSION,
  SUBMISSION_TEST_INSTRUCTIONS_MAX_LENGTH,
  SubmissionFindingSeverity,
  SubmissionScanStatus,
  SubmissionSelfReviewCode,
  SubmissionStatus,
} from '../shared/constants/submission.constant.ts';
import { STRICT_SEMANTIC_VERSION_PATTERN } from '../routes/node-catalog/node-catalog.constant.ts';
import { zDate } from '../shared/utils/zod.ts';
import { BaseWithUserFields } from './base.model.ts';

const SnapshotSchemaVersion = z.literal(SUBMISSION_SNAPSHOT_SCHEMA_VERSION);

// Counts and string lengths cannot bound a JSONB document on their own: one finding
// may carry an arbitrarily wide `details` object. Serialised size is the real limit.
const withinSerializedBytes = (max: number) => (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8') <= max;

const SemanticVersion = z
  .string()
  .max(SUBMISSION_RELEASE_VERSION_MAX_LENGTH)
  .regex(STRICT_SEMANTIC_VERSION_PATTERN, { message: 'Error.SubmissionVersionInvalid' });

export const ProductSubmissionSnapshot = z
  .object({
    schemaVersion: SnapshotSchemaVersion,
    productId: z.uuid(),
    publisherAccountId: z.uuid(),
    projectId: z.uuid(),
    name: z.string().min(1),
    slug: z.string().min(1),
    shortDescription: z.string().min(1),
    description: z.string().min(1),
    usageInstructions: z.string().nullable(),
    media: z.array(
      z
        .object({
          id: z.uuid(),
          staticId: z.uuid(),
          type: z.enum([ProductMediaType.ICON, ProductMediaType.COVER, ProductMediaType.GALLERY]),
          sortOrder: z.number().int().nonnegative(),
          altText: z.string().max(PRODUCT_MEDIA_ALT_TEXT_MAX_LENGTH).nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const ReleaseRequestSnapshot = z
  .object({
    schemaVersion: SnapshotSchemaVersion,
    version: SemanticVersion,
    changelog: z.string().trim().min(1).max(SUBMISSION_CHANGELOG_MAX_LENGTH),
    minimumLauncherVersion: SemanticVersion,
    minimumRuntimeVersion: SemanticVersion,
  })
  .strict();

export const SubmissionSelfReview = z
  .object({
    confirmed: z.literal(true),
    items: z
      .array(
        z
          .object({
            code: z.enum([
              SubmissionSelfReviewCode.PRODUCT_PRESENTATION_MATCHES_BEHAVIOR,
              SubmissionSelfReviewCode.WORKFLOW_TESTED,
              SubmissionSelfReviewCode.NO_RAW_CREDENTIALS,
              SubmissionSelfReviewCode.NO_ASSET_REFERENCES,
              SubmissionSelfReviewCode.RELEASE_INFORMATION_ACCURATE,
            ]),
            checked: z.literal(true),
          })
          .strict(),
      )
      .length(SUBMISSION_SELF_REVIEW_CODES.length)
      // Self-review is Publisher evidence, so every code must be present exactly once.
      .refine(
        (items) =>
          new Set(items.map(({ code }) => code)).size === SUBMISSION_SELF_REVIEW_CODES.length,
        { message: 'Error.SubmissionSelfReviewIncomplete' },
      ),
  })
  .strict();

export const SubmissionReviewContextSnapshot = z
  .object({
    schemaVersion: SnapshotSchemaVersion,
    purpose: z.string().trim().min(1).max(SUBMISSION_PURPOSE_MAX_LENGTH),
    testInstructions: z.string().trim().min(1).max(SUBMISSION_TEST_INSTRUCTIONS_MAX_LENGTH),
    knownLimitations: z
      .array(z.string().trim().min(1).max(SUBMISSION_KNOWN_LIMITATION_MAX_LENGTH))
      .max(SUBMISSION_KNOWN_LIMITATIONS_MAX_ITEMS)
      .refine((items) => new Set(items).size === items.length, {
        message: 'Error.SubmissionKnownLimitationsDuplicated',
      }),
    selfReview: SubmissionSelfReview,
  })
  .strict();

export const SubmissionScanFinding = z
  .object({
    code: z.string().min(1).max(SUBMISSION_FINDING_CODE_MAX_LENGTH),
    severity: z.enum([
      SubmissionFindingSeverity.INFO,
      SubmissionFindingSeverity.WARNING,
      SubmissionFindingSeverity.ERROR,
    ]),
    message: z.string().min(1).max(SUBMISSION_FINDING_MESSAGE_MAX_LENGTH),
    nodeId: z.string().max(SUBMISSION_FINDING_NODE_ID_MAX_LENGTH).optional(),
    details: z
      .record(z.string(), z.unknown())
      .refine(withinSerializedBytes(SUBMISSION_FINDING_DETAILS_MAX_BYTES), {
        message: 'Error.SubmissionFindingDetailsTooLarge',
      })
      .optional(),
  })
  .strict();

export const SubmissionScanResult = z
  .object({
    schemaVersion: SnapshotSchemaVersion,
    summary: z
      .object({
        totalRules: z.number().int().nonnegative(),
        passed: z.number().int().nonnegative(),
        warnings: z.number().int().nonnegative(),
        errors: z.number().int().nonnegative(),
        truncated: z.boolean(),
      })
      .strict(),
    findings: z.array(SubmissionScanFinding).max(SUBMISSION_SCAN_MAX_FINDINGS),
  })
  .strict()
  .refine(withinSerializedBytes(SUBMISSION_SCAN_RESULT_MAX_BYTES), {
    message: 'Error.SubmissionScanResultTooLarge',
  });

export const Submission = BaseWithUserFields.extend({
  productId: z.uuid(),
  workflowRevisionId: z.uuid(),
  number: z.number().int().positive(),
  status: z.enum([
    SubmissionStatus.PENDING_SCAN,
    SubmissionStatus.READY_FOR_REVIEW,
    SubmissionStatus.CHANGES_REQUESTED,
    SubmissionStatus.APPROVED,
    SubmissionStatus.REJECTED,
  ]),
  productSnapshot: ProductSubmissionSnapshot,
  releaseRequest: ReleaseRequestSnapshot,
  reviewContext: SubmissionReviewContextSnapshot,
  idempotencyKey: z.string().max(SUBMISSION_IDEMPOTENCY_KEY_MAX_LENGTH),
  requestHash: z.string().length(SUBMISSION_REQUEST_HASH_LENGTH),
  scanAttempt: z.number().int().positive(),
  scanStatus: z.enum([
    SubmissionScanStatus.QUEUED,
    SubmissionScanStatus.RUNNING,
    SubmissionScanStatus.PASSED,
    SubmissionScanStatus.FAILED,
    SubmissionScanStatus.ERROR,
  ]),
  scannerVersion: z.string().max(SUBMISSION_SCANNER_VERSION_MAX_LENGTH).nullable(),
  scanResult: SubmissionScanResult.nullable(),
  reviewedAt: zDate().nullable(),
  reviewFeedback: z.record(z.string(), z.unknown()).nullable(),
});

export type ProductSubmissionSnapshotType = z.infer<typeof ProductSubmissionSnapshot>;
export type ReleaseRequestSnapshotType = z.infer<typeof ReleaseRequestSnapshot>;
export type SubmissionReviewContextSnapshotType = z.infer<typeof SubmissionReviewContextSnapshot>;
export type SubmissionScanFindingType = z.infer<typeof SubmissionScanFinding>;
export type SubmissionScanResultType = z.infer<typeof SubmissionScanResult>;
export type SubmissionType = z.infer<typeof Submission>;
