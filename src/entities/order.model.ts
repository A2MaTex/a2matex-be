import { z } from 'zod';
import { OrderStatus } from '../shared/constants/order.constant.ts';
import { zDate, zJsonObject } from '../shared/utils/zod.ts';

export const OrderStatusSchema = z.enum([OrderStatus.PAID]);

export const Order = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
  productId: z.uuid(),
  productOfferId: z.uuid(),
  status: OrderStatusSchema,
  totalAmount: z.bigint(),
  offerSnapshot: zJsonObject(),
  paidAt: zDate(),
  idempotencyKey: z.uuid(),
  createdAt: zDate(),
});

export type OrderEntityType = z.infer<typeof Order>;
