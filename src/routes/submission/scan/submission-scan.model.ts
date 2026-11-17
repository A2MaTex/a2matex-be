import { z } from 'zod';

// Identifiers only. Large frozen content is read from PostgreSQL by the consumer, so
// the queue never carries graph, Runtime IR, snapshots or credentials.
export const SubmissionScanRequestedPayload = z
  .object({
    submissionId: z.uuid(),
    scanAttempt: z.number().int().positive(),
  })
  .strict();

export type SubmissionScanRequestedPayloadType = z.infer<typeof SubmissionScanRequestedPayload>;
