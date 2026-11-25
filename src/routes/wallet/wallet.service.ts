import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import {
  SystemAccountType,
  WalletDirection,
  WalletTransactionType,
} from '../../shared/constants/wallet.constant.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import type {
  GetMyWalletTransactionsInputType,
  GetMyWalletTransactionsOutputType,
  GrantToUserOutputType,
  IssueCreditOutputType,
} from './wallet.model.ts';
import {
  SystemAccountInsufficientFundsException,
  WalletGrantRecipientNotFoundException,
} from './wallet.error.ts';
import { WalletRepo, type WalletTransactionRow } from './wallet.repo.ts';

// Ghi sổ cho các module khác gọi. Mọi hàm ở đây chạy BÊN TRONG transaction mà module gọi đã
// mở bằng @Transactional() — PrismaService.getClient() tự nhận transaction đang mở, nên
// không hàm nào ở đây được tự mở transaction riêng. Ghi sổ và đổi số dư phải cùng thành
// công hoặc cùng không (FR-006).
@Injectable()
export class WalletService {
  // TransactionService must be injected under exactly this name: @Transactional() reads
  // `this.transactionService` off the instance and throws without it.
  constructor(
    @Inject(WalletRepo) private readonly walletRepo: WalletRepo,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
  ) {}

  // Biến động 0 đồng không để lại dòng nào (FR-007): hàng miễn phí và đơn có tỉ lệ hoa hồng
  // bằng 0 không làm số dư đổi, nên không có gì để ghi.
  private isNoop(amount: bigint): boolean {
    return amount <= 0n;
  }

  async recordTopUp(input: {
    userId: string;
    topUpTransactionId: string;
    amount: bigint;
    balanceAfter: bigint;
  }): Promise<void> {
    if (this.isNoop(input.amount)) return;
    await this.walletRepo.insertEntry({
      type: WalletTransactionType.TOPUP,
      direction: WalletDirection.CREDIT,
      amount: input.amount,
      balanceAfter: input.balanceAfter,
      userId: input.userId,
      topUpTransactionId: input.topUpTransactionId,
    });
  }

  async recordPurchase(input: {
    userId: string;
    orderId: string;
    amount: bigint;
    balanceAfter: bigint;
  }): Promise<void> {
    if (this.isNoop(input.amount)) return;
    await this.walletRepo.insertEntry({
      type: WalletTransactionType.PURCHASE,
      direction: WalletDirection.DEBIT,
      amount: input.amount,
      balanceAfter: input.balanceAfter,
      userId: input.userId,
      orderId: input.orderId,
    });
  }

  async recordEarning(input: {
    userId: string;
    orderId: string;
    amount: bigint;
    balanceAfter: bigint;
  }): Promise<void> {
    if (this.isNoop(input.amount)) return;
    await this.walletRepo.insertEntry({
      type: WalletTransactionType.EARNING,
      direction: WalletDirection.CREDIT,
      amount: input.amount,
      balanceAfter: input.balanceAfter,
      userId: input.userId,
      orderId: input.orderId,
    });
  }

  // Hoa hồng vào tài khoản của sàn. Cộng số dư và ghi sổ nằm cạnh nhau ở đây vì không
  // module nào khác cần tới số dư của sàn ngay lúc mua.
  async recordCommission(input: { orderId: string; amount: bigint }): Promise<void> {
    if (this.isNoop(input.amount)) return;
    const balanceAfter = await this.walletRepo.creditSystemAccount({ amount: input.amount });
    await this.walletRepo.insertEntry({
      type: WalletTransactionType.COMMISSION,
      direction: WalletDirection.CREDIT,
      amount: input.amount,
      balanceAfter,
      systemAccount: SystemAccountType.PLATFORM_REVENUE,
      orderId: input.orderId,
    });
  }

  // ---- Đọc lịch sử ----

  // userId tới từ token, không bao giờ từ tham số client (FR-025).
  async listMine({
    userId,
    query,
  }: {
    userId: string;
    query: GetMyWalletTransactionsInputType;
  }): Promise<GetMyWalletTransactionsOutputType> {
    const { page, pageSize, skip, take } = getPagination(query);
    const { items, totalItems } = await this.walletRepo.findManyByUserId({ userId, skip, take });

    return {
      items: items.map((row) => this.toOutput(row)),
      totalItems,
      page,
      pageSize,
      totalPages: Math.ceil(totalItems / pageSize),
    };
  }

  private toOutput(row: WalletTransactionRow) {
    return {
      id: row.id,
      type: row.type,
      direction: row.direction,
      amount: row.amount,
      balanceAfter: row.balanceAfter,
      orderId: row.orderId,
      topUpTransactionId: row.topUpTransactionId,
      note: row.note,
      createdAt: row.createdAt,
    };
  }

  // ---- Quản trị viên ----

  // Một lần CHUYỂN KHOẢN, không phải một khoản cộng: tiền rút từ tài khoản của sàn và hai
  // chân nối nhau bằng transferId. Nhờ vậy "mọi khoản quản trị viên cho đi đều có nguồn"
  // là điều chứng minh được bằng truy vấn, chứ không phải điều tin là đúng.
  @Transactional()
  async grantToUser(input: {
    userId: string;
    amount: bigint;
    note: string;
    createdById: string;
  }): Promise<GrantToUserOutputType> {
    // Thứ tự khoá BẮT BUỘC là Profile trước, SystemAccount sau — giống luồng mua hàng, nơi
    // order.service.ts khoá Profile của khách rồi mới chạm tài khoản của sàn ở bước ghi hoa
    // hồng. Làm ngược lại ở đây thì một lần cộng tiền chạy song song với một lần mua hàng
    // của chính người đó sẽ khoá chéo nhau: bên này giữ SystemAccount đợi Profile, bên kia
    // giữ Profile đợi SystemAccount, và Postgres huỷ một bên bằng lỗi deadlock 40P01 → 500.
    // order.repo.ts:100 đã có kỷ luật khoá Profile theo userId tăng dần vì đúng lớp lỗi này.
    //
    // Đổi lại: người nhận được cộng tiền trước khi biết ví sàn có đủ hay không. Vô hại —
    // cả hai nằm trong một transaction nên khoản cộng bị rollback cùng với lỗi 422.
    const userBalanceAfter = await this.walletRepo.creditUserBalance({
      userId: input.userId,
      amount: input.amount,
    });
    if (userBalanceAfter === null) {
      throw WalletGrantRecipientNotFoundException;
    }

    const systemBalanceAfter = await this.walletRepo.tryDebitSystemAccount({
      amount: input.amount,
    });
    if (systemBalanceAfter === null) {
      throw SystemAccountInsufficientFundsException;
    }

    const transferId = randomUUID();
    const debitLeg = await this.walletRepo.insertEntry({
      type: WalletTransactionType.ADMIN_GRANT,
      direction: WalletDirection.DEBIT,
      amount: input.amount,
      balanceAfter: systemBalanceAfter,
      systemAccount: SystemAccountType.PLATFORM_REVENUE,
      transferId,
      note: input.note,
      createdById: input.createdById,
    });
    await this.walletRepo.insertEntry({
      type: WalletTransactionType.ADMIN_GRANT,
      direction: WalletDirection.CREDIT,
      amount: input.amount,
      balanceAfter: userBalanceAfter,
      userId: input.userId,
      transferId,
      note: input.note,
      createdById: input.createdById,
    });

    return {
      transferId,
      userId: input.userId,
      amount: input.amount,
      userBalanceAfter,
      systemBalanceAfter,
      createdAt: debitLeg.createdAt,
    };
  }

  // Cửa DUY NHẤT tiền không có tiền mặt đối ứng đi vào hệ thống. Một chân, vì chân còn lại
  // nằm ngoài hệ thống và không phải là tiền thật — tổng các lần gọi hàm này là con số
  // "tiền tự phát hành" trong báo cáo dòng tiền.
  @Transactional()
  async issueCreditToSystemAccount(input: {
    amount: bigint;
    note: string;
    createdById: string;
  }): Promise<IssueCreditOutputType> {
    const balanceAfter = await this.walletRepo.creditSystemAccount({ amount: input.amount });
    const entry = await this.walletRepo.insertEntry({
      type: WalletTransactionType.ISSUED_CREDIT,
      direction: WalletDirection.CREDIT,
      amount: input.amount,
      balanceAfter,
      systemAccount: SystemAccountType.PLATFORM_REVENUE,
      note: input.note,
      createdById: input.createdById,
    });
    return { amount: input.amount, balanceAfter, createdAt: entry.createdAt };
  }
}
