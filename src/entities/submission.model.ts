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
  SUBMISSION_REVIEW_FEEDBACK_MAX_BYTES,
  SUBMISSION_REVIEW_ITEM_MESSAGE_MAX_LENGTH,
  SUBMISSION_REVIEW_ITEM_NODE_ID_MAX_LENGTH,
  SUBMISSION_REVIEW_MAX_ITEMS,
  SUBMISSION_REVIEW_SUMMARY_MAX_LENGTH,
  SUBMISSION_SCAN_MAX_FINDINGS,
  SUBMISSION_SCAN_RESULT_MAX_BYTES,
  SUBMISSION_SCANNER_VERSION_MAX_LENGTH,
  SUBMISSION_SNAPSHOT_SCHEMA_VERSION,
  SUBMISSION_TEST_INSTRUCTIONS_MAX_LENGTH,
  SubmissionFindingSeverity,
  SubmissionScanStatus,
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

type SnapshotMedia = { id: string; type: string; sortOrder: number };

function countOfType(media: SnapshotMedia[], type: string): number {
  return media.filter((item) => item.type === type).length;
}

// Compared rather than re-sorted: order is content. `type` ranks by enum declaration order.
const MEDIA_TYPE_RANK: Record<string, number> = {
  [ProductMediaType.ICON]: 0,
  [ProductMediaType.COVER]: 1,
  [ProductMediaType.GALLERY]: 2,
};

function isDeterministicallyOrdered(media: SnapshotMedia[]): boolean {
  for (let at = 1; at < media.length; at += 1) {
    const previous = media[at - 1] as SnapshotMedia;
    const current = media[at] as SnapshotMedia;
    const rank = (MEDIA_TYPE_RANK[previous.type] ?? 0) - (MEDIA_TYPE_RANK[current.type] ?? 0);
    if (rank > 0) {
      return false;
    }
    if (rank < 0) {
      continue;
    }
    if (previous.sortOrder > current.sortOrder) {
      return false;
    }
    if (previous.sortOrder === current.sortOrder && previous.id >= current.id) {
      return false;
    }
  }
  return true;
}

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
    media: z
      .array(
        z
          .object({
            id: z.uuid(),
            staticId: z.uuid(),
            type: z.enum([ProductMediaType.ICON, ProductMediaType.COVER, ProductMediaType.GALLERY]),
            sortOrder: z.number().int().nonnegative(),
            altText: z.string().max(PRODUCT_MEDIA_ALT_TEXT_MAX_LENGTH).nullable(),
          })
          .strict(),
      )
      // Enforced here so re-reading the frozen snapshot proves them without touching mutable
      // ProductMedia: one ICON, one COVER, and the Product order of type, sortOrder, id.
      .refine((media) => countOfType(media, ProductMediaType.ICON) <= 1, {
        message: 'Error.ProductMediaIconCardinality',
      })
      .refine((media) => countOfType(media, ProductMediaType.COVER) <= 1, {
        message: 'Error.ProductMediaCoverCardinality',
      })
      .refine(isDeterministicallyOrdered, { message: 'Error.ProductMediaOrderInvalid' }),
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

// Feedback is rendered as plain text, so a control character can only come from pasted
// machine output rather than from an Admin writing to a Publisher. Tab, newline and
// carriage return stay allowed: an Admin writes paragraphs. A lone surrogate is refused
// here too -- it survives JSON.stringify as an escape PostgreSQL cannot store as jsonb,
// so letting it through turns a validation error into a failure mid-transaction.
const ALLOWED_CONTROL_CHARACTERS = new Set([0x09, 0x0a, 0x0d]);

const isStorableText = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code <= 0x1f || code === 0x7f) && !ALLOWED_CONTROL_CHARACTERS.has(code)) {
      return false;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) {
        return false;
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
};

// Whitespace alone is nothing a Publisher can act on, and a decision that refuses a
// Submission owes them more than a space.
const plainText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, {
      message: 'Error.InvalidSubmissionReviewFeedback',
    })
    .refine(isStorableText, { message: 'Error.InvalidSubmissionReviewFeedback' });

// The only Submission content an Admin authors and the only one a Publisher reads back.
// Nothing here is copied from a scan result: `nodeId` is a Publisher-safe locator, not a
// finding identifier or rule code.
export const SubmissionReviewFeedback = z
  .object({
    summary: plainText(SUBMISSION_REVIEW_SUMMARY_MAX_LENGTH),
    items: z
      .array(
        z
          .object({
            message: plainText(SUBMISSION_REVIEW_ITEM_MESSAGE_MAX_LENGTH),
            nodeId: plainText(SUBMISSION_REVIEW_ITEM_NODE_ID_MAX_LENGTH).optional(),
          })
          .strict(),
      )
      .max(SUBMISSION_REVIEW_MAX_ITEMS)
      .optional(),
  })
  .strict()
  .refine(withinSerializedBytes(SUBMISSION_REVIEW_FEEDBACK_MAX_BYTES), {
    message: 'Error.SubmissionReviewFeedbackTooLarge',
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
  reviewFeedback: SubmissionReviewFeedback.nullable(),
});

export type ProductSubmissionSnapshotType = z.infer<typeof ProductSubmissionSnapshot>;
export type ReleaseRequestSnapshotType = z.infer<typeof ReleaseRequestSnapshot>;
export type SubmissionReviewContextSnapshotType = z.infer<typeof SubmissionReviewContextSnapshot>;
export type SubmissionScanFindingType = z.infer<typeof SubmissionScanFinding>;
export type SubmissionScanResultType = z.infer<typeof SubmissionScanResult>;
export type SubmissionReviewFeedbackType = z.infer<typeof SubmissionReviewFeedback>;
export type SubmissionType = z.infer<typeof Submission>;
