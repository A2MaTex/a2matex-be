import { z } from 'zod';
import { zDate } from '../shared/utils/zod.ts';

export const TopUpTransactionStatus = z.enum(['PENDING', 'CREDITED', 'UNMATCHED']);

export const TopUpTransaction = z.object({
  id: z.uuid(),
  userId: z.uuid().nullable(),
  referenceCode: z.string().nullable(),
  requestedAmount: z.bigint().nullable(),
  receivedAmount: z.bigint().nullable(),
  providerTransactionId: z.string().nullable(),
  rawContent: z.string().nullable(),
  status: TopUpTransactionStatus,
  creditedAt: zDate().nullable(),
  createdAt: zDate(),
  updatedAt: zDate().nullable(),
});

export type TopUpTransactionStatusType = z.infer<typeof TopUpTransactionStatus>;
export type TopUpTransactionType = z.infer<typeof TopUpTransaction>;
