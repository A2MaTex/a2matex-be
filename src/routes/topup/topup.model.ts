import { z } from 'zod';

export const CreateTopUpRequestInput = z
  .object({
    amount: z.number().int().positive(),
  })
  .strict();

export const CreateTopUpRequestOutput = z.object({
  referenceCode: z.string(),
  amount: z.number(),
  bankAccountNumber: z.string(),
  bankName: z.string(),
  accountHolderName: z.string(),
  transferContent: z.string(),
});

export const SepayWebhookPayload = z
  .object({
    id: z.coerce.string(),
    gateway: z.string(),
    transactionDate: z.string(),
    accountNumber: z.string(),
    content: z.string(),
    transferAmount: z.number().int(),
    transferType: z.string(),
  })
  .loose();

export type CreateTopUpRequestInputType = z.infer<typeof CreateTopUpRequestInput>;
export type CreateTopUpRequestOutputType = z.infer<typeof CreateTopUpRequestOutput>;
export type SepayWebhookPayloadType = z.infer<typeof SepayWebhookPayload>;
