// A purchase either commits in full or leaves nothing behind, so PENDING, CANCELLED and
// FAILED would be values nothing ever writes. Refunds arrive with their own spec and an
// ALTER TYPE ... ADD VALUE.
export const OrderStatus = {
  PAID: 'PAID',
} as const;

export type OrderStatusValue = (typeof OrderStatus)[keyof typeof OrderStatus];

// Version of the commercial terms copied onto every Order.
export const ORDER_OFFER_SNAPSHOT_SCHEMA_VERSION = '1.0';

export const ORDER_PAGE_SIZE_MAX = 100;
