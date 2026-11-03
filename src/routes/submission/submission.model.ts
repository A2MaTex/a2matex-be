import { z } from 'zod';
import {
  ProductSubmissionSnapshot,
  ReleaseRequestSnapshot,
  SubmissionReviewContextSnapshot,
} from '../../entities/submission.model.ts';

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

export type ReleaseRequestInputType = z.infer<typeof ReleaseRequestInput>;
export type SubmissionReviewContextInputType = z.infer<typeof SubmissionReviewContextInput>;
export type CreateSubmissionInputType = z.infer<typeof CreateSubmissionInput>;
export type CreateSubmissionOutputType = z.infer<typeof CreateSubmissionOutput>;
export type SubmissionIdParamType = z.infer<typeof SubmissionIdParam>;
export type ProductSubmissionSnapshotInput = Omit<
  z.infer<typeof ProductSubmissionSnapshot>,
  'schemaVersion'
>;
