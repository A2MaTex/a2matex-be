import { z } from 'zod';
import { OrderStatusSchema } from '../../entities/order.model.ts';
import { EntitlementEffectiveStatusSchema } from '../entitlement/entitlement.model.ts';
import { Product } from '../../entities/product.model.ts';
import {
  ORDER_OFFER_SNAPSHOT_SCHEMA_VERSION,
  ORDER_PAGE_SIZE_MAX,
} from '../../shared/constants/order.constant.ts';
import { ProductOfferType } from '../../shared/constants/product-offer.constant.ts';
import { zBigIntAsString, zDate, zJsonObject } from '../../shared/utils/zod.ts';

const Pagination = z.object({
  page: z.coerce.number().int().positive().safe().default(1),
  limit: z.coerce.number().int().positive().safe().max(ORDER_PAGE_SIZE_MAX).default(10),
});

// ---- Commercial terms frozen on the line (FR-006) ----

export const OfferSnapshotSchema = z.object({
  schemaVersion: z.literal(ORDER_OFFER_SNAPSHOT_SCHEMA_VERSION),
  offerType: z.enum([ProductOfferType.ONE_TIME, ProductOfferType.SUBSCRIPTION]),
  // Decimal string: the configured price ceiling is past Number.MAX_SAFE_INTEGER.
  priceAmount: z.string().regex(/^\d{1,19}$/),
  durationDays: z.number().int().positive().nullable(),
});

export type OfferSnapshotType = z.infer<typeof OfferSnapshotSchema>;

// ---- Shared params / outputs ----

export const OrderIdParam = z
  .object({
    orderId: z.uuid(),
  })
  .strict();

// Kept as a nested block because the clients read it, though the purchase now lives on the
// Order row: "id" repeats the Order id and "unitPriceAmount" the total (one Product per
// Order).
export const OrderItemOutput = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  productOfferId: z.uuid(),
  unitPriceAmount: zBigIntAsString(),
  // Written by this module against OfferSnapshotSchema; returned, not re-parsed.
  offerSnapshot: zJsonObject(OfferSnapshotSchema),
  // The Product's current name, not a snapshot: only the commercial terms are frozen.
  product: Product.pick({ id: true, name: true, slug: true, status: true }),
});

export const OrderOutput = z.object({
  id: z.uuid(),
  status: OrderStatusSchema,
  totalAmount: zBigIntAsString(),
  paidAt: zDate(),
  createdAt: zDate(),
  item: OrderItemOutput,
  // The split as it was settled. "publisherUserId" is deliberately absent: the customer
  // does not need to know who received the money, and exposing it would leak ownership.
  commissionRateBps: z.number().int().min(0).max(10000),
  commissionAmount: zBigIntAsString(),
  publisherAmount: zBigIntAsString(),
});

// z.input, not z.infer: the amounts leave Prisma as bigint and only become decimal
// strings when the response schema runs.
export type OrderOutputType = z.input<typeof OrderOutput>;

// ---- Create an Order (US1) ----

export const CreateOrderInput = z
  .object({
    productOfferId: z.uuid(),
  })
  .strict();

export type CreateOrderInputType = z.infer<typeof CreateOrderInput>;

// The access the purchase produced. A replay returns the entitlement as it stands now,
// not as it stood when the Order was paid, so both answers share this shape.
export const CreateOrderOutput = OrderOutput.extend({
  entitlement: z.object({
    id: z.uuid(),
    status: EntitlementEffectiveStatusSchema,
    startsAt: zDate(),
    expiresAt: zDate().nullable(),
  }),
});

export type CreateOrderOutputType = z.input<typeof CreateOrderOutput>;

// ---- Purchase history (US4) ----

export const GetMyOrdersInput = Pagination.strict();

export type GetMyOrdersInputType = z.infer<typeof GetMyOrdersInput>;

export const GetMyOrdersOutput = z.object({
  items: z.array(OrderOutput),
  totalItems: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

export type GetMyOrdersOutputType = z.input<typeof GetMyOrdersOutput>;

export { Pagination as OrderPagination };
