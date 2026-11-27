import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import {
  isValidEntryShape,
  SystemAccountType,
  type SystemAccountTypeValue,
  type WalletDirectionValue,
  type WalletTransactionTypeValue,
} from '../../shared/constants/wallet.constant.ts';

export type WalletTransactionRow = {
  id: string;
  type: WalletTransactionTypeValue;
  direction: WalletDirectionValue;
  amount: bigint;
  balanceAfter: bigint;
  orderId: string | null;
  topUpTransactionId: string | null;
  note: string | null;
  createdAt: Date;
};

// Sổ cái cho quản trị viên: khác bản của người dùng ở chỗ CÓ systemAccount và transferId,
// vì họ cần truy một lần chuyển khoản về cả hai chân của nó.
const ADMIN_LEDGER_SELECT = {
  id: true,
  userId: true,
  systemAccount: true,
  type: true,
  direction: true,
  amount: true,
  balanceAfter: true,
  orderId: true,
  topUpTransactionId: true,
  withdrawalRequestId: true,
  transferId: true,
  note: true,
  createdById: true,
  createdAt: true,
} as const;

export type AdminLedgerRow = {
  id: string;
  userId: string | null;
  systemAccount: SystemAccountTypeValue | null;
  type: WalletTransactionTypeValue;
  direction: WalletDirectionValue;
  amount: bigint;
  balanceAfter: bigint;
  orderId: string | null;
  topUpTransactionId: string | null;
  withdrawalRequestId: string | null;
  transferId: string | null;
  note: string | null;
  createdById: string | null;
  createdAt: Date;
};

// Một bút toán. Chủ tài khoản là userId HOẶC systemAccount, không bao giờ cả hai — database
// ép bằng WalletTransaction_account_check, nên kiểu ở đây chỉ cần phản ánh điều đó.
export type WalletEntryInput = {
  type: WalletTransactionTypeValue;
  direction: WalletDirectionValue;
  amount: bigint;
  balanceAfter: bigint;
  userId?: string;
  systemAccount?: SystemAccountTypeValue;
  orderId?: string;
  topUpTransactionId?: string;
  withdrawalRequestId?: string;
  transferId?: string;
  note?: string;
  createdById?: string;
};

@Injectable()
export class WalletRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  // ---- Ghi sổ ----

  // Returns createdAt as the row recorded it, not an application clock reading: the column
  // defaults to now(), which in Postgres is the transaction start, so a Date() taken after the
  // insert would disagree with what the history endpoint later shows for the same entry.
  insertEntry(input: WalletEntryInput): Promise<{ id: string; createdAt: Date }> {
    // Bắt tổ hợp sai ở đây thay vì để accountKind_check bắt: lỗi ràng buộc Postgres nổi
    // lên thành 500 không nói được chỗ nào sai. Database vẫn là chốt chặn cuối.
    const account = input.userId ? 'USER' : 'SYSTEM';
    if (!isValidEntryShape({ type: input.type, direction: input.direction, account })) {
      throw new Error(
        `Invalid wallet entry shape: ${input.type}/${input.direction}/${account}`,
      );
    }

    return this.prisma.walletTransaction.create({
      data: {
        type: input.type,
        direction: input.direction,
        amount: input.amount,
        balanceAfter: input.balanceAfter,
        userId: input.userId ?? null,
        systemAccount: input.systemAccount ?? null,
        orderId: input.orderId ?? null,
        topUpTransactionId: input.topUpTransactionId ?? null,
        withdrawalRequestId: input.withdrawalRequestId ?? null,
        transferId: input.transferId ?? null,
        note: input.note ?? null,
        createdById: input.createdById ?? null,
      },
      select: { id: true, createdAt: true },
    });
  }

  // ---- Số dư tài khoản của sàn ----

  // Không điều kiện: một khoản cộng không có cận dưới nào để vi phạm. Trả về số dư ngay từ
  // câu lệnh đã đổi nó — đọc lại bằng SELECT riêng là mở một cửa sổ tranh chấp.
  async creditSystemAccount({
    type = SystemAccountType.PLATFORM_REVENUE,
    amount,
  }: {
    type?: SystemAccountTypeValue;
    amount: bigint;
  }): Promise<bigint> {
    const row = await this.prisma.systemAccount.update({
      where: { type },
      data: { balance: { increment: amount }, updatedAt: new Date() },
      select: { balance: true },
    });
    return row.balance;
  }

  // Điều kiện nằm trong chính câu lệnh. Không dòng nào bị ảnh hưởng nghĩa là tài khoản của
  // sàn không đủ tiền — một tình huống nghiệp vụ bình thường ở giai đoạn đầu, không phải
  // lỗi hệ thống. Để CHECK của database bắt thì nó thành lỗi ràng buộc và trả 500.
  async tryDebitSystemAccount({
    type = SystemAccountType.PLATFORM_REVENUE,
    amount,
  }: {
    type?: SystemAccountTypeValue;
    amount: bigint;
  }): Promise<bigint | null> {
    const rows = await this.prisma.systemAccount.updateManyAndReturn({
      where: { type, balance: { gte: amount } },
      data: { balance: { decrement: amount }, updatedAt: new Date() },
      select: { balance: true },
    });
    return rows[0]?.balance ?? null;
  }

  // Doubles as the recipient check: no row matched means the Profile is missing or soft
  // deleted, and the caller turns that into a 404 without a separate lookup.
  async creditUserBalance({
    userId,
    amount,
  }: {
    userId: string;
    amount: bigint;
  }): Promise<bigint | null> {
    const rows = await this.prisma.profile.updateManyAndReturn({
      where: { userId, deletedAt: null },
      data: { balance: { increment: amount } },
      select: { balance: true },
    });
    return rows[0]?.balance ?? null;
  }

  // Đối xứng tryDebitSystemAccount: điều kiện `balance >= amount` nằm TRONG câu lệnh, vì để
  // Profile_balance_check bắt thì "không đủ tiền" thành lỗi 500. Không khớp dòng nào là
  // thiếu tiền hoặc hồ sơ đã xoá mềm — người gọi phân biệt bằng khoá dòng đang giữ.
  async tryDebitUserBalance({
    userId,
    amount,
  }: {
    userId: string;
    amount: bigint;
  }): Promise<bigint | null> {
    const rows = await this.prisma.profile.updateManyAndReturn({
      where: { userId, deletedAt: null, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
      select: { balance: true },
    });
    return rows[0]?.balance ?? null;
  }

  findSystemAccountBalance(
    type: SystemAccountTypeValue = SystemAccountType.PLATFORM_REVENUE,
  ): Promise<{ balance: bigint } | null> {
    return this.prisma.systemAccount.findUnique({
      where: { type },
      select: { balance: true },
    });
  }

  // ---- Quản trị viên: sổ cái toàn hệ thống (spec 013) ----

  // Ba bộ lọc độc lập, kết hợp bằng AND; bỏ trống nghĩa là không lọc theo tiêu chí đó.
  //
  // Mốc `to` so bằng `lt` chứ không `lte`: client truyền đầu ngày hôm sau là lấy trọn ngày
  // hôm nay mà không phải lo giây cuối cùng.
  //
  // Sắp theo createdAt kèm id: createdAt mặc định now() tức thời điểm mở transaction, nên
  // ba bút toán của cùng một đơn hàng mang CÙNG một mốc. Không có tiêu chí phụ thì chúng
  // xếp tuỳ ý và lật trang sẽ trùng hoặc sót dòng.
  async findLedger(input: {
    userId?: string;
    types?: WalletTransactionTypeValue[];
    from?: Date;
    to?: Date;
    skip: number;
    take: number;
  }): Promise<{ rows: AdminLedgerRow[]; totalItems: number }> {
    const where = {
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.types?.length ? { type: { in: input.types } } : {}),
      ...(input.from || input.to
        ? {
            createdAt: {
              ...(input.from ? { gte: input.from } : {}),
              ...(input.to ? { lt: input.to } : {}),
            },
          }
        : {}),
    };
    const [rows, totalItems] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: input.skip,
        take: input.take,
        select: ADMIN_LEDGER_SELECT,
      }),
      this.prisma.walletTransaction.count({ where }),
    ]);
    return { rows, totalItems };
  }

  // Gộp theo loại và chiều. Người gọi xếp thành hai nhóm vào/ra và bảng phải TỰ CÂN:
  // tổng vào trừ tổng ra bằng đúng số dư hiện tại.
  findBalanceBreakdown(userId: string) {
    return this.prisma.walletTransaction.groupBy({
      by: ['type', 'direction'],
      where: { userId },
      _sum: { amount: true },
      _count: { _all: true },
    });
  }

  // Trả null khi không có người dùng đó — người gọi biến thành 404 mà không cần truy vấn
  // riêng. Hồ sơ đã xoá mềm vẫn trả về, vì quản trị viên cần tra được ví của họ.
  async findUserForWallet(userId: string): Promise<{
    userId: string;
    fullName: string;
    email: string | null;
    balance: bigint;
  } | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, profile: { select: { fullName: true, balance: true } } },
    });
    if (!row) return null;
    return {
      userId: row.id,
      fullName: row.profile?.fullName ?? '',
      email: row.email,
      balance: row.profile?.balance ?? 0n,
    };
  }

  // ---- Quản trị viên: đối soát (spec 013) ----

  // Sáu truy vấn LẤY NGUYÊN từ docs/deployment-runbook.md mục B9.3, không viết lại: SC-009
  // đòi số liệu khớp TUYỆT ĐỐI với kết quả chạy tay, và cách chắc chắn nhất là dùng đúng
  // câu truy vấn đó.
  //
  // Bốn phép (a)(b)(c)(d) trả về DANH SÁCH DÒNG VI PHẠM chứ không chỉ đếm, để bảng nêu được
  // đích danh thay vì chỉ nói "có lỗi".
  //
  // Đây là route đắt nhất hệ thống — sáu truy vấn quét toàn bảng. Ở quy mô hiện tại không
  // đáng kể, nhưng sẽ xấu dần. Khi chậm thì việc đúng là chạy định kỳ và lưu kết quả.
  async runReconciliation() {
    const [a, b, c, d, f, e] = await Promise.all([
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT pr."userId", u.email, pr.balance::text AS balance,
               COALESCE(SUM(CASE w.direction WHEN 'CREDIT' THEN w.amount ELSE -w.amount END),0)::text
                 AS "fromLedger"
        FROM "Profile" pr
        JOIN "User" u ON u.id = pr."userId"
        LEFT JOIN "WalletTransaction" w ON w."userId" = pr."userId"
        WHERE pr."deletedAt" IS NULL
        GROUP BY pr."userId", u.email, pr.balance
        HAVING pr.balance <> COALESCE(
          SUM(CASE w.direction WHEN 'CREDIT' THEN w.amount ELSE -w.amount END), 0)`,
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT sa.type::text, sa.balance::text AS balance,
               COALESCE(SUM(CASE w.direction WHEN 'CREDIT' THEN w.amount ELSE -w.amount END),0)::text
                 AS "fromLedger"
        FROM "SystemAccount" sa
        LEFT JOIN "WalletTransaction" w ON w."systemAccount" = sa.type
        GROUP BY sa.type, sa.balance
        HAVING sa.balance <> COALESCE(
          SUM(CASE w.direction WHEN 'CREDIT' THEN w.amount ELSE -w.amount END), 0)`,
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT o.id, o."totalAmount"::text, o."publisherAmount"::text, o."commissionAmount"::text
        FROM "Order" o
        JOIN "WalletTransaction" w ON w."orderId" = o.id
        GROUP BY o.id, o."totalAmount", o."publisherAmount", o."commissionAmount"
        HAVING SUM(CASE WHEN w.type = 'PURCHASE' THEN w.amount ELSE 0 END) <> o."totalAmount"
            OR SUM(CASE WHEN w.type = 'EARNING' THEN w.amount ELSE 0 END) <> o."publisherAmount"
            OR SUM(CASE WHEN w.type = 'COMMISSION' THEN w.amount ELSE 0 END) <> o."commissionAmount"`,
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT "transferId" FROM "WalletTransaction"
        WHERE "transferId" IS NOT NULL
        GROUP BY "transferId"
        HAVING SUM(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END) <> 0
            OR count(*) <> 2`,
      this.prisma.$queryRaw<{ from_requests: string | null; from_ledger: string | null }[]>`
        SELECT
          (SELECT COALESCE(SUM(amount),0) FROM "WithdrawalRequest"
            WHERE status NOT IN ('CANCELLED'::"WithdrawalRequestStatus",
                                 'REJECTED'::"WithdrawalRequestStatus"))::text AS from_requests,
          ((SELECT COALESCE(SUM(amount),0) FROM "WalletTransaction" WHERE type = 'WITHDRAWAL')
           - (SELECT COALESCE(SUM(amount),0) FROM "WalletTransaction"
               WHERE type = 'WITHDRAWAL_REVERSAL'))::text AS from_ledger`,
      // Hai túi tiền rút tính theo TRẠNG THÁI ĐƠN, không theo sổ cái: đơn chưa chi vẫn là
      // khoản hệ thống đang nợ, chỉ đổi hình thức.
      this.prisma.$queryRaw<Record<string, string | null>[]>`
        SELECT
          (SELECT COALESCE(SUM("receivedAmount"),0) FROM "TopUpTransaction"
            WHERE "creditedAt" IS NOT NULL)::text AS cash_in,
          (SELECT COALESCE(SUM(amount),0) FROM "WalletTransaction"
            WHERE type = 'ISSUED_CREDIT')::text AS issued_credit,
          (SELECT COALESCE(SUM(amount),0) FROM "WithdrawalRequest"
            WHERE status = 'PAID'::"WithdrawalRequestStatus")::text AS paid_out,
          (SELECT COALESCE(SUM(balance),0) FROM "Profile"
            WHERE "deletedAt" IS NULL)::text AS owed_to_users,
          (SELECT COALESCE(balance,0) FROM "SystemAccount"
            WHERE type = 'PLATFORM_REVENUE')::text AS platform_balance,
          (SELECT COALESCE(SUM(amount),0) FROM "WithdrawalRequest"
            WHERE status IN ('PENDING'::"WithdrawalRequestStatus",
                             'APPROVED'::"WithdrawalRequestStatus"))::text AS awaiting_payout`,
    ]);
    return { a, b, c, d, f: f[0], e: e[0] };
  }

  // ---- Đọc lịch sử ----

  // Chỉ bút toán thuộc ví của chính người này. Chân DEBIT của một lần ADMIN_GRANT nằm ở tài
  // khoản của sàn nên không lọt vào đây, và COMMISSION / ISSUED_CREDIT cũng vậy.
  async findManyByUserId({
    userId,
    skip,
    take,
  }: {
    userId: string;
    skip: number;
    take: number;
  }): Promise<{ items: WalletTransactionRow[]; totalItems: number }> {
    const [items, totalItems] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where: { userId },
        // createdAt một mình KHÔNG phải thứ tự toàn phần: cột mặc định now(), tức thời
        // điểm bắt đầu transaction, nên hai bút toán cùng mốc sẽ xếp tuỳ ý và client lật
        // trang có thể thấy trùng dòng hoặc sót dòng. Cùng quy ước với order.repo.ts:236.
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
        select: {
          id: true,
          type: true,
          direction: true,
          amount: true,
          balanceAfter: true,
          orderId: true,
          topUpTransactionId: true,
          note: true,
          createdAt: true,
        },
      }),
      this.prisma.walletTransaction.count({ where: { userId } }),
    ]);
    return { items, totalItems };
  }
}
