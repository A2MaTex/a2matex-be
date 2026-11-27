import { z } from 'zod';
import { WalletDirection, WalletTransactionType } from '../shared/constants/wallet.constant.ts';
import { zDate } from '../shared/utils/zod.ts';
import { SystemAccountTypeSchema } from './system-account.model.ts';

export const WalletTransactionTypeSchema = z.enum([
  WalletTransactionType.TOPUP,
  WalletTransactionType.PURCHASE,
  WalletTransactionType.EARNING,
  WalletTransactionType.COMMISSION,
  WalletTransactionType.ADMIN_GRANT,
  WalletTransactionType.ISSUED_CREDIT,
  WalletTransactionType.WITHDRAWAL,
  WalletTransactionType.WITHDRAWAL_REVERSAL,
]);

export const WalletDirectionSchema = z.enum([WalletDirection.CREDIT, WalletDirection.DEBIT]);

// Một lần số dư của một tài khoản thay đổi. Ghi một lần, không sửa, không xoá: không có
// updatedAt và không có xoá mềm, vì đây là bản ghi lịch sử chứ không phải trạng thái.
export const WalletTransaction = z.object({
  id: z.uuid(),
  // Đúng một trong hai không rỗng. Database ép bằng WalletTransaction_account_check.
  userId: z.uuid().nullable(),
  systemAccount: SystemAccountTypeSchema.nullable(),
  type: WalletTransactionTypeSchema,
  direction: WalletDirectionSchema,
  // Luôn dương. Dấu nằm ở direction, không nằm ở số tiền.
  amount: z.bigint(),
  // Lấy từ chính thao tác đã đổi số dư, không tính riêng rồi ghi vào.
  balanceAfter: z.bigint(),
  orderId: z.uuid().nullable(),
  topUpTransactionId: z.uuid().nullable(),
  // Nối hai chân của một lần chuyển khoản. Chỉ và luôn có với ADMIN_GRANT.
  transferId: z.uuid().nullable(),
  note: z.string().nullable(),
  createdById: z.uuid().nullable(),
  createdAt: zDate(),
});

export type WalletTransactionEntityType = z.infer<typeof WalletTransaction>;
