import { Inject, Injectable } from '@nestjs/common';
import {
  WalletDirection,
  type WalletTransactionTypeValue,
} from '../../shared/constants/wallet.constant.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import { WalletUserNotFoundException } from './wallet.error.ts';
import type {
  GetAdminLedgerInputType,
  GetUserWalletInputType,
  GetAdminLedgerOutputType,
  ReconciliationOutputType,
  UserWalletOutputType,
} from './wallet.model.ts';
import { WalletRepo, type AdminLedgerRow } from './wallet.repo.ts';

@Injectable()
export class AdminWalletService {
  constructor(@Inject(WalletRepo) private readonly walletRepo: WalletRepo) {}

  // ---- Sổ cái toàn hệ thống ----

  async listLedger(query: GetAdminLedgerInputType): Promise<GetAdminLedgerOutputType> {
    const { page, pageSize, skip, take } = getPagination(query);
    const { rows, totalItems } = await this.walletRepo.findLedger({
      userId: query.userId,
      types: query.types,
      from: query.from,
      to: query.to,
      skip,
      take,
    });

    return {
      items: rows.map((row) => this.toEntry(row)),
      totalItems,
      page,
      pageSize,
      totalPages: Math.ceil(totalItems / pageSize),
    };
  }

  // ---- Ví một người dùng ----

  async getUserWallet(input: {
    userId: string;
    query: GetUserWalletInputType;
  }): Promise<UserWalletOutputType> {
    const user = await this.walletRepo.findUserForWallet(input.userId);
    if (!user) {
      throw WalletUserNotFoundException;
    }

    const { page, pageSize, skip, take } = getPagination(input.query);
    const [grouped, { rows, totalItems }] = await Promise.all([
      this.walletRepo.findBalanceBreakdown(input.userId),
      this.walletRepo.findLedger({ userId: input.userId, skip, take }),
    ]);

    const inRows: { type: WalletTransactionTypeValue; total: bigint; count: number }[] = [];
    const outRows: { type: WalletTransactionTypeValue; total: bigint; count: number }[] = [];
    // Xếp nhóm theo CHIỀU, không theo danh sách loại: WITHDRAWAL_REVERSAL là CREDIT nên tự
    // rơi vào nhóm vào. Dùng một danh sách loại thì thêm loại mới là phải nhớ sửa, mà quên
    // sẽ làm mọi ví từng có đơn bị từ chối hiện ra là lệch.
    for (const g of grouped) {
      const type = g.type as WalletTransactionTypeValue;
      const row = { type, total: g._sum.amount ?? 0n, count: g._count._all };
      (g.direction === WalletDirection.CREDIT ? inRows : outRows).push(row);
    }

    const sum = (rows_: { total: bigint }[]) => rows_.reduce((acc, r) => acc + r.total, 0n);

    return {
      user,
      balance: user.balance,
      breakdown: {
        in: inRows,
        out: outRows,
        totalIn: sum(inRows),
        totalOut: sum(outRows),
      },
      items: rows.map((row) => this.toEntry(row)),
      totalItems,
      page,
      pageSize,
      totalPages: Math.ceil(totalItems / pageSize),
    };
  }

  // ---- Đối soát ----

  async getReconciliation(): Promise<ReconciliationOutputType> {
    const r = await this.walletRepo.runReconciliation();

    // Truy vấn ép ::text nên mọi giá trị về đây là chuỗi; dùng BigInt thay vì number vì
    // tổng tiền vượt Number.MAX_SAFE_INTEGER được.
    const n = (v: string | null | undefined) => BigInt(v ?? '0');
    const cashIn = n(r.e?.cash_in);
    const issuedCredit = n(r.e?.issued_credit);
    const paidOut = n(r.e?.paid_out);
    const owedToUsers = n(r.e?.owed_to_users);
    const platformBalance = n(r.e?.platform_balance);
    const awaitingPayout = n(r.e?.awaiting_payout);

    // Đẳng thức HAI TÚI. Tiền đang chờ chi vẫn là khoản hệ thống đang nợ — nó đã rời ví nhà
    // phát hành nhưng còn nằm trong ngân hàng công ty. Gộp nó vào "đã chi" sẽ làm sổ sách
    // báo thiếu đúng bằng tổng các đơn chưa chi.
    const leftSide = cashIn + issuedCredit - paidOut;
    const rightSide = owedToUsers + platformBalance + awaitingPayout;

    const fromRequests = n(r.f?.from_requests);
    const fromLedger = n(r.f?.from_ledger);

    return {
      cashflow: {
        cashIn,
        issuedCredit,
        paidOut,
        owedToUsers,
        platformBalance,
        awaitingPayout,
        leftSide,
        rightSide,
        balanced: leftSide === rightSide,
      },
      checks: [
        { code: 'a', label: 'Ví người dùng khớp sổ cái', ok: r.a.length === 0, offenders: r.a },
        { code: 'b', label: 'Ví sàn khớp sổ cái', ok: r.b.length === 0, offenders: r.b },
        { code: 'c', label: 'Đơn hàng khớp ba bút toán', ok: r.c.length === 0, offenders: r.c },
        { code: 'd', label: 'Chuyển khoản đủ hai chân', ok: r.d.length === 0, offenders: r.d },
        {
          code: 'f',
          label: 'Đơn rút chưa hoàn khớp sổ cái',
          ok: fromRequests === fromLedger,
          offenders:
            fromRequests === fromLedger
              ? []
              : [
                  {
                    fromRequests: fromRequests.toString(),
                    fromLedger: fromLedger.toString(),
                    diff: (fromRequests - fromLedger).toString(),
                  },
                ],
        },
      ],
    };
  }

  private toEntry(row: AdminLedgerRow) {
    return {
      id: row.id,
      userId: row.userId,
      systemAccount: row.systemAccount,
      type: row.type,
      direction: row.direction,
      amount: row.amount,
      balanceAfter: row.balanceAfter,
      orderId: row.orderId,
      topUpTransactionId: row.topUpTransactionId,
      withdrawalRequestId: row.withdrawalRequestId,
      transferId: row.transferId,
      note: row.note,
      createdById: row.createdById,
      createdAt: row.createdAt,
    };
  }
}
