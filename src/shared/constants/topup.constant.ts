export const TopUpTransactionStatus = {
  PENDING: 'PENDING',
  CREDITED: 'CREDITED',
  UNMATCHED: 'UNMATCHED',
} as const;

export type TopUpTransactionStatusType =
  (typeof TopUpTransactionStatus)[keyof typeof TopUpTransactionStatus];
