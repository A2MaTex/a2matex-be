import { z } from 'zod';
import { Order } from '../../entities/order.model.ts';
import { OrderItem } from '../../entities/order-item.model.ts';
import { zBigIntAsNumber, zDate } from '../../shared/utils/zod.ts';

export const CreateOrderInput = z
  .object({
    offerId: z.uuid(),
  })
  .strict();

export const OrderItemOutput = OrderItem.pick({
  id: true,
  productId: true,
  productOfferId: true,
  offerSnapshot: true,
}).extend({
  unitPriceMinor: zBigIntAsNumber(),
});

export const CreateOrderOutput = Order.pick({
  id: true,
  status: true,
  currency: true,
}).extend({
  totalMinor: zBigIntAsNumber(),
  paidAt: zDate(),
  item: OrderItemOutput,
  entitlementId: z.uuid(),
});

export type CreateOrderInputType = z.infer<typeof CreateOrderInput>;
// z.input, not z.infer: the money columns leave Prisma as bigint and only become numbers
// when the response interceptor serializes them.
export type CreateOrderOutputType = z.input<typeof CreateOrderOutput>;
