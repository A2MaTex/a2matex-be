import { z } from 'zod';

// Identifiers only. Large frozen content is read from PostgreSQL by the consumer, so
// the queue never carries graph, Runtime IR, snapshots or credentials.
export const ProductReleaseBuildRequestedPayload = z
  .object({
    submissionId: z.uuid(),
    createdById: z.uuid(),
  })
  .strict();

export type ProductReleaseBuildRequestedPayloadType = z.infer<
  typeof ProductReleaseBuildRequestedPayload
>;
