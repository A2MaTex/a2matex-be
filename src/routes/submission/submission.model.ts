import { z } from 'zod';
import {
  ProductSubmissionSnapshot,
  ReleaseRequestSnapshot,
  SubmissionReviewContextSnapshot,
  SubmissionScanResult,
} from '../../entities/submission.model.ts';
import { EditorGraph } from '../workflow-validation/workflow-validation.model.ts';
import {
  SubmissionScanStatus,
  SubmissionStatus,
} from '../../shared/constants/submission.constant.ts';
import { PaginationQuerySchema } from '../../shared/models/request.model.ts';
import { zDate, zJsonObject } from '../../shared/utils/zod.ts';

export const SubmissionStatusSchema = z.enum([
  SubmissionStatus.PENDING_SCAN,
  SubmissionStatus.READY_FOR_REVIEW,
  SubmissionStatus.CHANGES_REQUESTED,
  SubmissionStatus.APPROVED,
  SubmissionStatus.REJECTED,
]);

export const SubmissionScanStatusSchema = z.enum([
  SubmissionScanStatus.QUEUED,
  SubmissionScanStatus.RUNNING,
  SubmissionScanStatus.PASSED,
  SubmissionScanStatus.FAILED,
  SubmissionScanStatus.ERROR,
]);

// Read-side only. Everything these cover was validated by its own schema before it
// was stored and is immutable afterwards; the schema passed in documents the field
// without parsing it.
const StoredJson = zJsonObject();
const StoredProductSnapshot = zJsonObject(ProductSubmissionSnapshot);
const StoredReleaseRequest = zJsonObject(ReleaseRequestSnapshot);
const StoredReviewContext = zJsonObject(SubmissionReviewContextSnapshot);
const StoredScanResult = zJsonObject(SubmissionScanResult);
const StoredEditorGraph = zJsonObject(EditorGraph);

export const SubmissionIdParam = z
  .object({
    submissionId: z.uuid(),
  })
  .strict();

// The API accepts the snapshot shapes without `schemaVersion`; the Backend stamps it
// when it writes the immutable snapshot, so a client can never choose the version.
export const ReleaseRequestInput = ReleaseRequestSnapshot.omit({ schemaVersion: true });

export const SubmissionReviewContextInput = SubmissionReviewContextSnapshot.omit({
  schemaVersion: true,
});

export const CreateSubmissionInput = z
  .object({
    productId: z.uuid(),
    sourceDraftVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    releaseRequest: ReleaseRequestInput,
    reviewContext: SubmissionReviewContextInput,
  })
  .strict();

export const CreateSubmissionOutput = z
  .object({
    id: z.uuid(),
  })
  .strict();

export const GetSubmissionListInput = PaginationQuerySchema.extend({
  status: SubmissionStatusSchema.optional(),
  productId: z.uuid().optional(),
}).strict();

// Presentation comes from the frozen snapshot, never from the mutable Product, so a
// later Product edit cannot change how a past Submission reads.
export const SubmissionListItem = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  workflowRevisionId: z.uuid(),
  number: z.number().int().positive(),
  status: SubmissionStatusSchema,
  product: z.object({
    name: z.string(),
    slug: z.string(),
    iconStaticId: z.uuid().nullable(),
  }),
  requestedVersion: z.string(),
  createdAt: zDate(),
  updatedAt: zDate().nullable(),
  createdById: z.uuid(),
});

// Scanner evidence is Admin-only. The owner projection never carries these fields and
// the owner query never selects their columns.
export const AdminSubmissionListItem = SubmissionListItem.extend({
  scanAttempt: z.number().int().positive(),
  scanStatus: SubmissionScanStatusSchema,
  scannerVersion: z.string().nullable(),
  scanSummary: z
    .object({
      totalRules: z.number().int().nonnegative(),
      passed: z.number().int().nonnegative(),
      warnings: z.number().int().nonnegative(),
      errors: z.number().int().nonnegative(),
      truncated: z.boolean(),
    })
    .nullable(),
});

const listOutput = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    totalItems: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    totalPages: z.number().int().nonnegative(),
  });

export const GetSubmissionListOutput = listOutput(SubmissionListItem);
export const GetAdminSubmissionListOutput = listOutput(AdminSubmissionListItem);

// One route serves two shapes, and `createZodDto` cannot take a union, so the wire
// schema is the superset with the scan fields optional. It only has to avoid
// stripping the Admin ones: what actually keeps them away from an owner is the owner
// query, which never puts a scan column in its SELECT list.
export const GetSubmissionListResponse = listOutput(
  SubmissionListItem.extend({
    scanAttempt: AdminSubmissionListItem.shape.scanAttempt.optional(),
    scanStatus: AdminSubmissionListItem.shape.scanStatus.optional(),
    scannerVersion: AdminSubmissionListItem.shape.scannerVersion.optional(),
    scanSummary: AdminSubmissionListItem.shape.scanSummary.optional(),
  }),
);

// The complete frozen revision, which spec section 6.3 puts behind detail and keeps
// out of list output.
export const SubmissionWorkflowRevision = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  sourceDraftVersion: z.number().int().positive(),
  sourceDraftContentHash: z.string(),
  contentHash: z.string(),
  editorGraph: StoredEditorGraph,
  runtimeIr: StoredJson,
  inputSchema: StoredJson,
  nodeDefinitionManifest: StoredJson,
  capabilityManifest: StoredJson,
  validationSummary: StoredJson,
  testSummary: StoredJson,
  createdAt: zDate(),
});

export const SubmissionDetailOutput = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  workflowRevisionId: z.uuid(),
  number: z.number().int().positive(),
  status: SubmissionStatusSchema,
  productSnapshot: StoredProductSnapshot,
  releaseRequest: StoredReleaseRequest,
  reviewContext: StoredReviewContext,
  // Admin-authored and intentionally shown to the Publisher; the Review module owns
  // its shape, so it stays an opaque object until that module lands.
  reviewedAt: zDate().nullable(),
  reviewFeedback: StoredJson.nullable(),
  workflowRevision: SubmissionWorkflowRevision,
  createdAt: zDate(),
  createdById: z.uuid(),
  updatedAt: zDate().nullable(),
});

export const AdminSubmissionDetailOutput = SubmissionDetailOutput.extend({
  scanAttempt: z.number().int().positive(),
  scanStatus: SubmissionScanStatusSchema,
  scannerVersion: z.string().nullable(),
  scanResult: StoredScanResult.nullable(),
  updatedById: z.uuid().nullable(),
});

// Same reason as the list response: one route, two shapes, and `createZodDto` takes
// no union. The owner query is what actually withholds the scan columns.
export const SubmissionDetailResponse = SubmissionDetailOutput.extend({
  scanAttempt: AdminSubmissionDetailOutput.shape.scanAttempt.optional(),
  scanStatus: AdminSubmissionDetailOutput.shape.scanStatus.optional(),
  scannerVersion: AdminSubmissionDetailOutput.shape.scannerVersion.optional(),
  scanResult: AdminSubmissionDetailOutput.shape.scanResult.optional(),
  updatedById: AdminSubmissionDetailOutput.shape.updatedById.optional(),
});

export type ReleaseRequestInputType = z.infer<typeof ReleaseRequestInput>;
export type SubmissionReviewContextInputType = z.infer<typeof SubmissionReviewContextInput>;
export type CreateSubmissionInputType = z.infer<typeof CreateSubmissionInput>;
export type CreateSubmissionOutputType = z.infer<typeof CreateSubmissionOutput>;
export type SubmissionIdParamType = z.infer<typeof SubmissionIdParam>;
export type GetSubmissionListInputType = z.infer<typeof GetSubmissionListInput>;
export type SubmissionListItemType = z.infer<typeof SubmissionListItem>;
export type AdminSubmissionListItemType = z.infer<typeof AdminSubmissionListItem>;
export type GetSubmissionListOutputType = z.infer<typeof GetSubmissionListOutput>;
export type GetAdminSubmissionListOutputType = z.infer<typeof GetAdminSubmissionListOutput>;
export type GetSubmissionListResponseType = z.infer<typeof GetSubmissionListResponse>;
export type SubmissionDetailOutputType = z.infer<typeof SubmissionDetailOutput>;
export type AdminSubmissionDetailOutputType = z.infer<typeof AdminSubmissionDetailOutput>;
export type SubmissionDetailResponseType = z.infer<typeof SubmissionDetailResponse>;
export type ProductSubmissionSnapshotInput = Omit<
  z.infer<typeof ProductSubmissionSnapshot>,
  'schemaVersion'
>;
