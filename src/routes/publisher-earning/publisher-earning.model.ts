import { z } from 'zod';
import { ORDER_PAGE_SIZE_MAX } from '../../shared/constants/order.constant.ts';
import { zBigIntAsString, zDate } from '../../shared/utils/zod.ts';

export const GetPublisherEarningsInput = z
  .object({
    page: z.coerce.number().int().positive().safe().default(1),
    limit: z.coerce.number().int().positive().safe().max(ORDER_PAGE_SIZE_MAX).default(10),
  })
  .strict();

// One sale, from the seller's side. Amounts are decimal strings for the same reason
// totalAmount is: the price ceiling is past Number.MAX_SAFE_INTEGER.
export const PublisherEarningOutput = z.object({
  orderId: z.uuid(),
  productId: z.uuid(),
  productName: z.string().nullable(),
  totalAmount: zBigIntAsString(),
  commissionAmount: zBigIntAsString(),
  publisherAmount: zBigIntAsString(),
  commissionRateBps: z.number().int().min(0).max(10000),
  paidAt: zDate(),
});

export const GetPublisherEarningsOutput = z.object({
  items: z.array(PublisherEarningOutput),
  totalItems: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

// grossAmount = commissionAmount + netAmount always holds, because each Order already
// satisfies that by constraint.
export const PublisherEarningSummaryOutput = z.object({
  orderCount: z.number().int().nonnegative(),
  grossAmount: zBigIntAsString(),
  commissionAmount: zBigIntAsString(),
  netAmount: zBigIntAsString(),
});

export type GetPublisherEarningsInputType = z.infer<typeof GetPublisherEarningsInput>;
// z.input, not z.infer: the service hands back BigInt and the schema is what turns it
// into a decimal string on the wire. Same convention as OrderOutputType.
export type GetPublisherEarningsOutputType = z.input<typeof GetPublisherEarningsOutput>;
export type PublisherEarningSummaryOutputType = z.input<typeof PublisherEarningSummaryOutput>;
