import { z } from 'zod';
import { OrderStatus } from '../shared/constants/order.constant.ts';
import { zDate, zJsonObject } from '../shared/utils/zod.ts';

export const OrderStatusSchema = z.enum([OrderStatus.PAID]);

export const Order = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
  status: OrderStatusSchema,
  totalAmount: z.bigint(),
  paidAt: zDate(),
  idempotencyKey: z.uuid(),
  createdAt: zDate(),
});

export const OrderItem = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  productId: z.uuid(),
  productOfferId: z.uuid(),
  unitPriceAmount: z.bigint(),
  offerSnapshot: zJsonObject(),
  createdAt: zDate(),
});

export type OrderEntityType = z.infer<typeof Order>;
export type OrderItemEntityType = z.infer<typeof OrderItem>;
