import { z } from 'zod';
import {
  WalletDirectionSchema,
  WalletTransactionTypeSchema,
} from '../../entities/wallet-transaction.model.ts';
import { LEDGER_PAGE_SIZE_MAX, WALLET_PAGE_SIZE_MAX } from '../../shared/constants/wallet.constant.ts';
import { zBigIntAsString, zCoerceDate, zDate } from '../../shared/utils/zod.ts';

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

// ---- Quản trị viên: sổ cái toàn hệ thống (spec 013) ----

// Ba bộ lọc độc lập, kết hợp bằng AND; bỏ trống nghĩa là không lọc theo tiêu chí đó.
// `types` nhận nhiều giá trị vì câu hỏi thực tế là "cho tôi xem mọi khoản tôi cộng tay",
// tức ADMIN_GRANT và ISSUED_CREDIT cùng lúc.
export const GetAdminLedgerInput = z
  .object({
    page: z.coerce.number().int().positive().safe().default(1),
    limit: z.coerce.number().int().positive().safe().max(LEDGER_PAGE_SIZE_MAX).default(10),
    userId: z.uuid().optional(),
    types: z
      .union([WalletTransactionTypeSchema, z.array(WalletTransactionTypeSchema)])
      .optional()
      .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
    from: zCoerceDate().optional(),
    to: zCoerceDate().optional(),
  })
  .strict()
  .superRefine(({ from, to }, ctx) => {
    if (from && to && from > to) {
      ctx.addIssue({ code: 'custom', message: 'Error.LedgerDateRangeInvalid', path: ['from'] });
    }
  });

export type GetAdminLedgerInputType = z.infer<typeof GetAdminLedgerInput>;

// Khác WalletTransactionOutput của người dùng: quản trị viên CÓ nhìn thấy systemAccount và
// transferId, vì họ cần truy được một lần chuyển khoản về cả hai chân của nó.
export const AdminLedgerEntryOutput = z.object({
  id: z.uuid(),
  userId: z.uuid().nullable(),
  systemAccount: z.string().nullable(),
  type: WalletTransactionTypeSchema,
  direction: WalletDirectionSchema,
  amount: zBigIntAsString(),
  balanceAfter: zBigIntAsString(),
  orderId: z.uuid().nullable(),
  topUpTransactionId: z.uuid().nullable(),
  withdrawalRequestId: z.uuid().nullable(),
  transferId: z.uuid().nullable(),
  note: z.string().nullable(),
  createdById: z.uuid().nullable(),
  createdAt: zDate(),
});

export const GetAdminLedgerOutput = z.object({
  items: z.array(AdminLedgerEntryOutput),
  totalItems: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
});

export type GetAdminLedgerOutputType = z.input<typeof GetAdminLedgerOutput>;

// ---- Quản trị viên: ví một người dùng ----

const BreakdownRow = z.object({
  type: WalletTransactionTypeSchema,
  total: zBigIntAsString(),
  count: z.number(),
});

// totalIn − totalOut PHẢI bằng đúng balance. Một bảng dùng để quyết định chi tiền mà không
// tự cân được thì không kiểm chứng được.
export const UserWalletOutput = z.object({
  user: z.object({
    userId: z.uuid(),
    fullName: z.string(),
    email: z.string().nullable(),
  }),
  balance: zBigIntAsString(),
  breakdown: z.object({
    in: z.array(BreakdownRow),
    out: z.array(BreakdownRow),
    totalIn: zBigIntAsString(),
    totalOut: zBigIntAsString(),
  }),
  items: z.array(AdminLedgerEntryOutput),
  totalItems: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
});

export type UserWalletOutputType = z.input<typeof UserWalletOutput>;

// Route xem ví một người CHỈ nhận phân trang. Dùng chung GetAdminLedgerInput sẽ nhận cả
// userId/types/from/to rồi âm thầm vứt đi — quản trị viên lọc "chỉ xem khoản rút" trước khi
// duyệt chi sẽ nhận về toàn bộ sổ cái kèm HTTP 200 mà không có dấu hiệu nào là bộ lọc trượt.
export const GetUserWalletInput = z
  .object({
    page: z.coerce.number().int().positive().safe().default(1),
    limit: z.coerce.number().int().positive().safe().max(LEDGER_PAGE_SIZE_MAX).default(10),
  })
  .strict();

export type GetUserWalletInputType = z.infer<typeof GetUserWalletInput>;

export const UserIdParam = z.object({ userId: z.uuid() }).strict();
export type UserIdParamType = z.infer<typeof UserIdParam>;

// ---- Quản trị viên: đối soát ----

const ReconciliationCheck = z.object({
  code: z.string(),
  label: z.string(),
  ok: z.boolean(),
  offenders: z.array(z.record(z.string(), z.unknown())),
});

export const ReconciliationOutput = z.object({
  cashflow: z.object({
    cashIn: zBigIntAsString(),
    issuedCredit: zBigIntAsString(),
    paidOut: zBigIntAsString(),
    owedToUsers: zBigIntAsString(),
    platformBalance: zBigIntAsString(),
    awaitingPayout: zBigIntAsString(),
    leftSide: zBigIntAsString(),
    rightSide: zBigIntAsString(),
    balanced: z.boolean(),
  }),
  checks: z.array(ReconciliationCheck),
});

export type ReconciliationOutputType = z.input<typeof ReconciliationOutput>;
