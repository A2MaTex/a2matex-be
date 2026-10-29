export const OrderStatus = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
} as const;

export type OrderStatusValue = (typeof OrderStatus)[keyof typeof OrderStatus];

export const PaymentStatus = {
  PENDING: 'PENDING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;

export type PaymentStatusValue = (typeof PaymentStatus)[keyof typeof PaymentStatus];

// v1 settles against the wallet, so there is no external gateway to name.
export const PAYMENT_PROVIDER_WALLET = 'WALLET';

export const ORDER_CURRENCY_VND = 'VND';

export const ORDER_SNAPSHOT_SCHEMA_VERSION = '1.0';
