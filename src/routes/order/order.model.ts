import { z } from 'zod';
import { Order, OrderStatusSchema } from '../../entities/order.model.ts';
import { OrderItem } from '../../entities/order-item.model.ts';
import { PaymentTransaction } from '../../entities/payment-transaction.model.ts';
import {
  PRODUCT_NAME_MAX_LENGTH,
  PRODUCT_SLUG_MAX_LENGTH,
} from '../../shared/constants/product.constant.ts';
import { PaginationQuerySchema } from '../../shared/models/request.model.ts';
import { zBigIntAsNumber, zDate } from '../../shared/utils/zod.ts';

export const OrderIdParam = z
  .object({
    orderId: z.uuid(),
  })
  .strict();

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

// Nullable: a Product may still be a nameless draft when its Order is listed.
export const OrderProductSummary = z.object({
  name: z.string().max(PRODUCT_NAME_MAX_LENGTH).nullable(),
  slug: z.string().max(PRODUCT_SLUG_MAX_LENGTH).nullable(),
});

export const OrderOutput = Order.pick({
  id: true,
  status: true,
  currency: true,
  paidAt: true,
  createdAt: true,
}).extend({
  totalMinor: zBigIntAsNumber(),
  item: OrderItemOutput.extend({
    product: OrderProductSummary,
  }),
});

export const OrderPaymentOutput = PaymentTransaction.pick({
  id: true,
  provider: true,
  status: true,
  currency: true,
  createdAt: true,
}).extend({
  amountMinor: zBigIntAsNumber(),
});

// Both nullable: the schema allows a PENDING Order with neither, even though v1 never
// writes one.
export const GetOrderDetailOutput = OrderOutput.extend({
  payment: OrderPaymentOutput.nullable(),
  entitlementId: z.uuid().nullable(),
});

export const GetOrderListInput = PaginationQuerySchema.extend({
  status: OrderStatusSchema.optional(),
}).strict();

export const GetOrderListOutput = z.object({
  items: z.array(OrderOutput),
  totalItems: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
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
export type GetOrderListInputType = z.infer<typeof GetOrderListInput>;
export type GetOrderDetailOutputType = z.input<typeof GetOrderDetailOutput>;
export type OrderOutputType = z.input<typeof OrderOutput>;
export type GetOrderListOutputType = z.input<typeof GetOrderListOutput>;
