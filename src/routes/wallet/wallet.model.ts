import { z } from 'zod';
import {
  WalletDirectionSchema,
  WalletTransactionTypeSchema,
} from '../../entities/wallet-transaction.model.ts';
import { WALLET_PAGE_SIZE_MAX } from '../../shared/constants/wallet.constant.ts';
import { zBigIntAsString, zDate } from '../../shared/utils/zod.ts';

const Pagination = z.object({
  page: z.coerce.number().int().positive().safe().default(1),
  limit: z.coerce.number().int().positive().safe().max(WALLET_PAGE_SIZE_MAX).default(10),
});

// Một dòng lịch sử ví của chính người đang đăng nhập.
//
// Cố ý KHÔNG có "systemAccount" và "transferId": người nhận tiền bù không cần biết khoản đó
// rút từ đâu, và lộ ra chỉ thêm bề mặt không ai dùng. Cũng vì lọc theo userId mà COMMISSION
// và ISSUED_CREDIT không bao giờ lọt vào đây — chúng thuộc tài khoản của sàn.
export const WalletTransactionOutput = z.object({
  id: z.uuid(),
  type: WalletTransactionTypeSchema,
  direction: WalletDirectionSchema,
  // Luôn dương; dấu nằm ở direction. Chuỗi thập phân vì trần giá vượt Number.MAX_SAFE_INTEGER.
  amount: zBigIntAsString(),
  balanceAfter: zBigIntAsString(),
  orderId: z.uuid().nullable(),
  topUpTransactionId: z.uuid().nullable(),
  // Chỉ ADMIN_GRANT mới có: lý do quản trị viên ghi lúc cộng tiền.
  note: z.string().nullable(),
  createdAt: zDate(),
});

export type WalletTransactionOutputType = z.input<typeof WalletTransactionOutput>;

// Không có tham số nào nhận id người dùng. Đó là cách FR-025 được thi hành ở tầng thiết kế
// chứ không phải ở tầng kiểm tra: không có gì để kiểm vì không có gì để truyền.
export const GetMyWalletTransactionsInput = Pagination.strict();

export type GetMyWalletTransactionsInputType = z.infer<typeof GetMyWalletTransactionsInput>;

export const GetMyWalletTransactionsOutput = z.object({
  items: z.array(WalletTransactionOutput),
  totalItems: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

export type GetMyWalletTransactionsOutputType = z.input<typeof GetMyWalletTransactionsOutput>;

// ---- Đầu vào của quản trị viên ----

const INVALID_AMOUNT = 'Error.WalletAmountInvalid';
const INVALID_NOTE = 'Error.WalletNoteRequired';

// Chuỗi thập phân, không phải số: trần giá đã vượt Number.MAX_SAFE_INTEGER. Mẫu regex loại
// dấu, dấu chấm thập phân, ký hiệu mũ và khoảng trắng — nhưng KHÔNG đủ để chặn trần: 19 chữ
// số cho phép tới 9999999999999999999, vượt BIGINT. Thiếu refine thứ hai thì một số quá lớn
// đi lọt tới Postgres và thành lỗi 22003 "bigint out of range", tức 500 cho một lỗi nhập liệu.
const BIGINT_MAX = 9223372036854775807n;

const AmountInput = z
  .string()
  .regex(/^\d{1,19}$/, INVALID_AMOUNT)
  .transform((value) => BigInt(value))
  .refine((value) => value > 0n && value <= BIGINT_MAX, INVALID_AMOUNT);

// Bắt buộc và không rỗng SAU KHI trim: một lý do toàn khoảng trắng qua được tầng ứng dụng
// sẽ bị database từ chối bằng WalletTransaction_actor_check, tức là 500 cho một lỗi nhập
// liệu hoàn toàn đoán trước được.
const NoteInput = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, INVALID_NOTE);

export const GrantToUserInput = z
  .object({
    userId: z.uuid(),
    amount: AmountInput,
    note: NoteInput,
  })
  .strict();

export type GrantToUserInputType = z.infer<typeof GrantToUserInput>;

export const GrantToUserOutput = z.object({
  transferId: z.uuid(),
  userId: z.uuid(),
  amount: zBigIntAsString(),
  userBalanceAfter: zBigIntAsString(),
  // Trả về cả số dư ví sàn là có chủ ý: quản trị viên thấy ngay còn lại bao nhiêu nên biết
  // khi nào phải bơm thêm trước khi thao tác tiếp.
  systemBalanceAfter: zBigIntAsString(),
  createdAt: zDate(),
});

export type GrantToUserOutputType = z.input<typeof GrantToUserOutput>;

export const IssueCreditInput = z
  .object({
    amount: AmountInput,
    note: NoteInput,
  })
  .strict();

export type IssueCreditInputType = z.infer<typeof IssueCreditInput>;

export const IssueCreditOutput = z.object({
  amount: zBigIntAsString(),
  balanceAfter: zBigIntAsString(),
  createdAt: zDate(),
});

export type IssueCreditOutputType = z.input<typeof IssueCreditOutput>;
