// Loại biến động số dư. Thêm giá trị mới không đụng bản ghi đã có — nhưng ALTER TYPE phải
// nằm ở MIGRATION RIÊNG với chỗ dùng nó, vì Prisma bọc mỗi file trong một transaction và
// PostgreSQL không cho dùng giá trị enum vừa thêm trong cùng transaction.
export const WalletTransactionType = {
  TOPUP: 'TOPUP',
  PURCHASE: 'PURCHASE',
  EARNING: 'EARNING',
  COMMISSION: 'COMMISSION',
  ADMIN_GRANT: 'ADMIN_GRANT',
  ISSUED_CREDIT: 'ISSUED_CREDIT',
  WITHDRAWAL: 'WITHDRAWAL',
  WITHDRAWAL_REVERSAL: 'WITHDRAWAL_REVERSAL',
} as const;

export type WalletTransactionTypeValue =
  (typeof WalletTransactionType)[keyof typeof WalletTransactionType];

// Chiều luôn nhìn từ tài khoản ghi trên chính dòng đó: CREDIT là số dư của tài khoản ấy
// tăng. Một lần chuyển khoản vì thế để lại hai dòng ngược chiều nhau.
export const WalletDirection = {
  CREDIT: 'CREDIT',
  DEBIT: 'DEBIT',
} as const;

export type WalletDirectionValue = (typeof WalletDirection)[keyof typeof WalletDirection];

export const SystemAccountType = {
  PLATFORM_REVENUE: 'PLATFORM_REVENUE',
} as const;

export type SystemAccountTypeValue =
  (typeof SystemAccountType)[keyof typeof SystemAccountType];

// Chín tổ hợp hợp lệ, không hơn. Database đã ép đúng bảng này qua
// WalletTransaction_accountKind_check; bản sao ở đây được WalletRepo.insertEntry đọc để một
// tổ hợp sai bị bắt thành lỗi lập trình có tên, thay vì thành lỗi ràng buộc 500 từ Postgres.
export const WALLET_ENTRY_SHAPES = [
  { type: WalletTransactionType.TOPUP, direction: WalletDirection.CREDIT, account: 'USER' },
  { type: WalletTransactionType.PURCHASE, direction: WalletDirection.DEBIT, account: 'USER' },
  { type: WalletTransactionType.EARNING, direction: WalletDirection.CREDIT, account: 'USER' },
  { type: WalletTransactionType.COMMISSION, direction: WalletDirection.CREDIT, account: 'SYSTEM' },
  { type: WalletTransactionType.ADMIN_GRANT, direction: WalletDirection.DEBIT, account: 'SYSTEM' },
  { type: WalletTransactionType.ADMIN_GRANT, direction: WalletDirection.CREDIT, account: 'USER' },
  { type: WalletTransactionType.ISSUED_CREDIT, direction: WalletDirection.CREDIT, account: 'SYSTEM' },
  { type: WalletTransactionType.WITHDRAWAL, direction: WalletDirection.DEBIT, account: 'USER' },
  {
    type: WalletTransactionType.WITHDRAWAL_REVERSAL,
    direction: WalletDirection.CREDIT,
    account: 'USER',
  },
] as const;

export const WALLET_PAGE_SIZE_MAX = 100;

// Một tổ hợp (loại, chiều, phía tài khoản) có nằm trong bảng trên không.
export const isValidEntryShape = (input: {
  type: WalletTransactionTypeValue;
  direction: WalletDirectionValue;
  account: 'USER' | 'SYSTEM';
}): boolean =>
  WALLET_ENTRY_SHAPES.some(
    (shape) =>
      shape.type === input.type &&
      shape.direction === input.direction &&
      shape.account === input.account,
  );
