import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import {
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

  findSystemAccountBalance(
    type: SystemAccountTypeValue = SystemAccountType.PLATFORM_REVENUE,
  ): Promise<{ balance: bigint } | null> {
    return this.prisma.systemAccount.findUnique({
      where: { type },
      select: { balance: true },
    });
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
