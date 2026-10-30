import { z } from 'zod';
import { PaymentStatus } from '../shared/constants/order.constant.ts';
import { zDate } from '../shared/utils/zod.ts';

export const PaymentStatusSchema = z.enum([
  PaymentStatus.PENDING,
  PaymentStatus.SUCCEEDED,
  PaymentStatus.FAILED,
  PaymentStatus.CANCELLED,
]);

export const PaymentTransaction = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  provider: z.string(),
  providerTransactionId: z.string().nullable(),
  status: PaymentStatusSchema,
  currency: z.string(),
  amountMinor: z.bigint(),
  providerResult: z.record(z.string(), z.json()),
  createdAt: zDate(),
  updatedAt: zDate().nullable(),
});

export type PaymentTransactionEntityType = z.infer<typeof PaymentTransaction>;
