import { z } from 'zod';
import { zDate } from '../shared/utils/zod.ts';

export const OrderItemOfferSnapshot = z.record(z.string(), z.json());

export const OrderItem = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  productId: z.uuid(),
  productOfferId: z.uuid(),
  unitPriceMinor: z.bigint(),
  offerSnapshot: OrderItemOfferSnapshot,
  createdAt: zDate(),
});

export type OrderItemEntityType = z.infer<typeof OrderItem>;
