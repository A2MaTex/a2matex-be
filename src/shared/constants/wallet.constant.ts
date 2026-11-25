// Loại biến động số dư. Thêm giá trị mới không đụng bản ghi đã có, nên phase 4 (rút tiền)
// và spec giữ tiền bảo hành đều chỉ cần một ALTER TYPE ... ADD VALUE.
export const WalletTransactionType = {
  TOPUP: 'TOPUP',
  PURCHASE: 'PURCHASE',
  EARNING: 'EARNING',
  COMMISSION: 'COMMISSION',
  ADMIN_GRANT: 'ADMIN_GRANT',
  ISSUED_CREDIT: 'ISSUED_CREDIT',
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

// Bảy tổ hợp hợp lệ, không hơn. Database đã ép đúng bảng này qua
// WalletTransaction_accountKind_check; bản sao ở đây để tầng ứng dụng không phải nhớ và
// để một tổ hợp sai bị bắt trước khi chạm tới database.
export const WALLET_ENTRY_SHAPES = [
  { type: WalletTransactionType.TOPUP, direction: WalletDirection.CREDIT, account: 'USER' },
  { type: WalletTransactionType.PURCHASE, direction: WalletDirection.DEBIT, account: 'USER' },
  { type: WalletTransactionType.EARNING, direction: WalletDirection.CREDIT, account: 'USER' },
  { type: WalletTransactionType.COMMISSION, direction: WalletDirection.CREDIT, account: 'SYSTEM' },
  { type: WalletTransactionType.ADMIN_GRANT, direction: WalletDirection.DEBIT, account: 'SYSTEM' },
  { type: WalletTransactionType.ADMIN_GRANT, direction: WalletDirection.CREDIT, account: 'USER' },
  { type: WalletTransactionType.ISSUED_CREDIT, direction: WalletDirection.CREDIT, account: 'SYSTEM' },
] as const;

export const WALLET_PAGE_SIZE_MAX = 100;
