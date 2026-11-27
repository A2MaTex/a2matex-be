import { z } from 'zod';
import { WithdrawalRequestStatusSchema } from '../../entities/withdrawal-request.model.ts';
import {
  WITHDRAWAL_ADMIN_PAGE_SIZE_MAX,
  WITHDRAWAL_PAGE_SIZE_MAX,
  WithdrawalRequestStatus,
} from '../../shared/constants/withdrawal.constant.ts';
import { zBigIntAsString, zBigIntString, zDate } from '../../shared/utils/zod.ts';

const Pagination = z.object({
  page: z.coerce.number().int().positive().safe().default(1),
  limit: z.coerce.number().int().positive().safe().max(WITHDRAWAL_PAGE_SIZE_MAX).default(10),
});

// ---- Input ----

export const CreateWithdrawalInput = z
  .object({
    amount: zBigIntString(),
    bankAccountNumber: z.string().trim().min(1).max(50),
    bankName: z.string().trim().min(1).max(255),
    bankAccountHolder: z.string().trim().min(1).max(255),
  })
  .strict();

export type CreateWithdrawalInputType = z.infer<typeof CreateWithdrawalInput>;

export const GetMyWithdrawalsInput = Pagination.strict();
export type GetMyWithdrawalsInputType = z.infer<typeof GetMyWithdrawalsInput>;

export const WithdrawalIdParam = z.object({ withdrawalId: z.uuid() }).strict();
export type WithdrawalIdParamType = z.infer<typeof WithdrawalIdParam>;

// ---- Output ----

export const WithdrawalOutput = z.object({
  id: z.uuid(),
  amount: zBigIntAsString(),
  status: WithdrawalRequestStatusSchema,
  bankAccountNumber: z.string(),
  bankName: z.string(),
  bankAccountHolder: z.string(),
  bankTransferRef: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  createdAt: zDate(),
  processedAt: zDate().nullable(),
});

// z.input chứ không z.infer: zBigIntAsString() cho string SAU transform, service trả bigint.
export type WithdrawalOutputType = z.input<typeof WithdrawalOutput>;

// balanceAfter chỉ có ở hai đường làm đổi số dư; route đọc trả kèm sẽ gợi ý sai rằng đó là
// số dư tại thời điểm tạo đơn.
export const WithdrawalMutationOutput = WithdrawalOutput.extend({
  balanceAfter: zBigIntAsString(),
});

export type WithdrawalMutationOutputType = z.input<typeof WithdrawalMutationOutput>;

export const GetMyWithdrawalsOutput = z.object({
  items: z.array(WithdrawalOutput),
  totalItems: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
});

export type GetMyWithdrawalsOutputType = z.input<typeof GetMyWithdrawalsOutput>;

// ---- Chống lặp ----

// Một type dùng cho cả chỗ ghi lẫn chỗ so, nên thêm trường vào đây là TypeScript báo lỗi ở
// cả hai — không thể thêm mà quên đưa vào phép so. Đủ bốn trường là bắt buộc: cùng khoá
// nhưng khác SỐ TÀI KHOẢN mà trả đơn cũ sẽ khiến tiền đi tới nơi người dùng tưởng đã đổi.
export type WithdrawalClaim = {
  amount: bigint;
  bankAccountNumber: string;
  bankName: string;
  bankAccountHolder: string;
};

export const sameClaim = (a: WithdrawalClaim, b: WithdrawalClaim): boolean =>
  a.amount === b.amount &&
  a.bankAccountNumber === b.bankAccountNumber &&
  a.bankName === b.bankName &&
  a.bankAccountHolder === b.bankAccountHolder;

// ---- Quản trị viên (spec 013) ----

const StatusEnum = z.enum([
  WithdrawalRequestStatus.PENDING,
  WithdrawalRequestStatus.APPROVED,
  WithdrawalRequestStatus.REJECTED,
  WithdrawalRequestStatus.PAID,
  WithdrawalRequestStatus.CANCELLED,
]);

// Bỏ trống `status` nghĩa là KHÔNG lọc — trả mọi trạng thái kể cả đã huỷ và bị từ chối.
// Màn hình hàng đợi tự lọc lấy thứ nó cần; API không tự thu hẹp dữ liệu.
export const GetAdminWithdrawalsInput = z
  .object({
    page: z.coerce.number().int().positive().safe().default(1),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .safe()
      .max(WITHDRAWAL_ADMIN_PAGE_SIZE_MAX)
      .default(10),
    status: z
      .union([StatusEnum, z.array(StatusEnum)])
      .optional()
      .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  })
  .strict();

export type GetAdminWithdrawalsInputType = z.infer<typeof GetAdminWithdrawalsInput>;

// Quản trị viên phải nhận ra mình đang chi tiền cho AI mà không cần tra cứu thêm, nên khối
// này mang tên và email chứ không chỉ một mã định danh.
export const AdminWithdrawalOutput = WithdrawalOutput.extend({
  publisher: z.object({
    userId: z.uuid(),
    fullName: z.string(),
    email: z.string().nullable(),
  }),
  processedById: z.uuid().nullable(),
});

export type AdminWithdrawalOutputType = z.input<typeof AdminWithdrawalOutput>;

export const GetAdminWithdrawalsOutput = z.object({
  items: z.array(AdminWithdrawalOutput),
  totalItems: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
});

export type GetAdminWithdrawalsOutputType = z.input<typeof GetAdminWithdrawalsOutput>;

// `.trim()` chạy TRƯỚC `.min(1)`: chuỗi toàn khoảng trắng phải bị từ chối như chuỗi rỗng.
//
// Thông điệp là KHOÁ LỖI, không để Zod trả "Too small: expected string…": hợp đồng hứa
// Error.WithdrawalRejectionReasonRequired và client dịch theo khoá đó.
export const RejectWithdrawalInput = z
  .object({
    reason: z.string().trim().min(1, 'Error.WithdrawalRejectionReasonRequired').max(1000),
  })
  .strict();

export type RejectWithdrawalInputType = z.infer<typeof RejectWithdrawalInput>;

export const MarkPaidWithdrawalInput = z
  .object({
    bankTransferRef: z.string().trim().min(1, 'Error.WithdrawalTransferRefRequired').max(255),
  })
  .strict();

export type MarkPaidWithdrawalInputType = z.infer<typeof MarkPaidWithdrawalInput>;
