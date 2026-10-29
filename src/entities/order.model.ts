import { z } from 'zod';
import { OrderStatus } from '../shared/constants/order.constant.ts';
import { zDate } from '../shared/utils/zod.ts';

export const OrderStatusSchema = z.enum([
  OrderStatus.PENDING,
  OrderStatus.PAID,
  OrderStatus.CANCELLED,
  OrderStatus.FAILED,
]);

export const Order = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
  status: OrderStatusSchema,
  currency: z.string(),
  totalMinor: z.bigint(),
  paidAt: zDate().nullable(),
  createdAt: zDate(),
  updatedAt: zDate().nullable(),
});

export type OrderEntityType = z.infer<typeof Order>;
