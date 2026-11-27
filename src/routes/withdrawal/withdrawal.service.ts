import { Inject, Injectable, Logger } from '@nestjs/common';
import { SystemSettingKey } from '../../shared/constants/system-setting.constant.ts';
import { WITHDRAWAL_COOLDOWN_HOURS } from '../../shared/constants/withdrawal.constant.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import { isPrismaError } from '../../shared/utils/prisma.ts';
import { PublisherAccessPolicy } from '../publisher/publisher-access.policy.ts';
import { SystemSettingService } from '../system-setting/system-setting.service.ts';
import { WalletRepo } from '../wallet/wallet.repo.ts';
import { WalletService } from '../wallet/wallet.service.ts';
import {
  WithdrawalIdempotencyKeyReusedException,
  WithdrawalBelowMinimumException,
  WithdrawalInsufficientBalanceException,
  WithdrawalMinAmountUnavailableException,
  WithdrawalNotFoundException,
  WithdrawalNotPendingException,
  WithdrawalProfileNotFoundException,
  withdrawalCooldownActiveException,
} from './withdrawal.error.ts';
import {
  sameClaim,
  type CreateWithdrawalInputType,
  type GetMyWithdrawalsInputType,
  type GetMyWithdrawalsOutputType,
  type WithdrawalClaim,
  type WithdrawalMutationOutputType,
  type WithdrawalOutputType,
} from './withdrawal.model.ts';
import { WithdrawalRepo, type WithdrawalRow } from './withdrawal.repo.ts';

@Injectable()
export class WithdrawalService {
  private readonly logger = new Logger(WithdrawalService.name);

  // Phải đúng tên `transactionService`: @Transactional() đọc nó off instance và ném lỗi
  // lúc chạy nếu thiếu, trong khi build vẫn xanh.
  constructor(
    @Inject(WithdrawalRepo) private readonly withdrawalRepo: WithdrawalRepo,
    @Inject(WalletRepo) private readonly walletRepo: WalletRepo,
    @Inject(WalletService) private readonly walletService: WalletService,
    @Inject(SystemSettingService) private readonly systemSettingService: SystemSettingService,
    @Inject(PublisherAccessPolicy) private readonly publisherAccess: PublisherAccessPolicy,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
  ) {}

  // ---- Mức rút tối thiểu ----

  private async readMinAmount(): Promise<bigint> {
    try {
      const { amount } = await this.systemSettingService.get(
        SystemSettingKey.WITHDRAWAL_MIN_AMOUNT,
      );
      return BigInt(amount);
    } catch (error) {
      // Lỗi hạ tầng giữ nguyên hình dạng của nó: biến thành "lỗi cấu hình" sẽ chỉ người vận
      // hành đi sửa một dòng SystemSetting bình thường. Giống order.service.ts:62.
      if (isPrismaError(error)) {
        throw error;
      }
      this.logger.error(
        `Withdrawal minimum unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw WithdrawalMinAmountUnavailableException;
    }
  }

  // ---- Tạo đơn (US1) ----

  async create(input: {
    data: CreateWithdrawalInputType;
    idempotencyKey: string;
    publisherUserId: string;
  }): Promise<WithdrawalMutationOutputType> {
    const { data, idempotencyKey, publisherUserId } = input;

    // Kiểm trước khi mở transaction: yêu cầu chắc chắn bị từ chối không nên giữ khoá nào.
    await this.publisherAccess.assertActivePublisher(publisherUserId);

    const claim = this.toClaim(data);

    // Chốt 1, chạy trước mọi quy tắc nghiệp vụ — nhất là trước mốc 24 giờ, nếu không mọi
    // lần thử lại do mạng đều bị từ chối "chưa đủ 24 giờ".
    const claimed = await this.withdrawalRepo.findByIdempotencyKey({
      publisherUserId,
      idempotencyKey,
    });
    if (claimed) {
      return this.resolveReplay(claimed, claim);
    }

    try {
      return await this.createInTransaction({ data, idempotencyKey, publisherUserId, claim });
    } catch (error) {
      // Chốt 3. Kẻ thua trong một cặp chạy song song hiếm khi vấp chính khoá chống lặp —
      // nó vấp một quy tắc nghiệp vụ trước. Có đơn cho khoá này thì câu trả lời đúng là
      // bản lặp, không phải lỗi mà lần chạy này tình cờ gặp.
      const concurrent = await this.withdrawalRepo.findByIdempotencyKey({
        publisherUserId,
        idempotencyKey,
      });
      if (concurrent) {
        return this.resolveReplay(concurrent, claim);
      }
      throw error;
    }
  }

  // Trừ số dư, ghi đơn và ghi sổ trong cùng một transaction: cả ba cùng thành công hoặc không.
  @Transactional()
  private async createInTransaction(input: {
    data: CreateWithdrawalInputType;
    idempotencyKey: string;
    publisherUserId: string;
    claim: WithdrawalClaim;
  }): Promise<WithdrawalMutationOutputType> {
    const { data, idempotencyKey, publisherUserId, claim } = input;

    // Khoá Profile LUÔN TRƯỚC, và là khoá duy nhất ở đường này.
    const profile = await this.withdrawalRepo.lockPublisherProfile(publisherUserId);
    if (!profile) {
      this.logger.error(`Withdrawal has no Profile to debit publisherUserId=${publisherUserId}`);
      throw WithdrawalProfileNotFoundException;
    }

    // Chốt 2. Khoá Profile đã serialize, nên kẻ thua thấy đơn của kẻ thắng.
    const concurrent = await this.withdrawalRepo.findByIdempotencyKey({
      publisherUserId,
      idempotencyKey,
    });
    if (concurrent) {
      return this.resolveReplay(concurrent, claim);
    }

    // Đọc trong transaction, không cache: cache sẽ cho đơn đi qua mức đã bị thay.
    const minAmount = await this.readMinAmount();
    if (claim.amount < minAmount) {
      this.logger.warn(
        `Withdrawal rejected: below minimum publisherUserId=${publisherUserId} ` +
          `amount=${claim.amount} min=${minAmount}`,
      );
      throw WithdrawalBelowMinimumException;
    }

    const cooldown = await this.withdrawalRepo.findCooldownState({
      publisherUserId,
      cooldownHours: WITHDRAWAL_COOLDOWN_HOURS,
    });
    if (cooldown) {
      this.logger.warn(
        `Withdrawal rejected: cooldown active publisherUserId=${publisherUserId} ` +
          `nextAllowedAt=${cooldown.nextAllowedAt.toISOString()}`,
      );
      throw withdrawalCooldownActiveException(cooldown.nextAllowedAt);
    }

    // Điều kiện nằm trong chính câu lệnh. Đã giữ khoá Profile nên không khớp dòng nào ở
    // đây chỉ có thể là thiếu tiền.
    const balanceAfter = await this.walletRepo.tryDebitUserBalance({
      userId: publisherUserId,
      amount: claim.amount,
    });
    if (balanceAfter === null) {
      this.logger.warn(
        `Withdrawal rejected: insufficient balance publisherUserId=${publisherUserId} ` +
          `amount=${claim.amount} balance=${profile.balance}`,
      );
      throw WithdrawalInsufficientBalanceException;
    }

    const row = await this.withdrawalRepo.createRequest({
      publisherUserId,
      amount: claim.amount,
      idempotencyKey,
      bankAccountNumber: data.bankAccountNumber,
      bankName: data.bankName,
      bankAccountHolder: data.bankAccountHolder,
    });

    // Sau createRequest: bút toán mang withdrawalRequestId, id chỉ có khi đơn đã được ghi.
    await this.walletService.recordWithdrawal({
      userId: publisherUserId,
      withdrawalRequestId: row.id,
      amount: claim.amount,
      balanceAfter,
    });

    this.logger.log(
      `Withdrawal created withdrawalId=${row.id} publisherUserId=${publisherUserId} ` +
        `amount=${claim.amount} balanceAfter=${balanceAfter}`,
    );

    return { ...this.toOutput(row), balanceAfter };
  }

  // ---- Huỷ đơn (US3) ----

  async cancel(input: {
    withdrawalId: string;
    publisherUserId: string;
  }): Promise<WithdrawalMutationOutputType> {
    await this.publisherAccess.assertActivePublisher(input.publisherUserId);
    return this.cancelInTransaction(input);
  }

  @Transactional()
  private async cancelInTransaction(input: {
    withdrawalId: string;
    publisherUserId: string;
  }): Promise<WithdrawalMutationOutputType> {
    const { withdrawalId, publisherUserId } = input;

    // Vẫn Profile trước, giữ thứ tự khoá toàn cục.
    const profile = await this.withdrawalRepo.lockPublisherProfile(publisherUserId);
    if (!profile) {
      throw WithdrawalProfileNotFoundException;
    }

    const cancelled = await this.withdrawalRepo.cancelIfPending({ withdrawalId, publisherUserId });
    if (!cancelled) {
      // Tính đúng đắn đã xong — đọc lại chỉ để chọn thông điệp lỗi.
      const existing = await this.withdrawalRepo.findOneForPublisher({
        withdrawalId,
        publisherUserId,
      });
      if (!existing) {
        throw WithdrawalNotFoundException;
      }
      throw WithdrawalNotPendingException;
    }

    const balanceAfter = await this.walletRepo.creditUserBalance({
      userId: publisherUserId,
      amount: cancelled.amount,
    });
    if (balanceAfter === null) {
      // Hồ sơ đã khoá ở trên, nên không khớp dòng nào là bất biến vỡ.
      this.logger.error(
        `Withdrawal refund matched no Profile row publisherUserId=${publisherUserId} ` +
          `withdrawalId=${withdrawalId}`,
      );
      throw new Error('Withdrawal refund affected no row');
    }

    await this.walletService.recordWithdrawalReversal({
      userId: publisherUserId,
      withdrawalRequestId: cancelled.id,
      amount: cancelled.amount,
      balanceAfter,
    });

    this.logger.log(
      `Withdrawal cancelled withdrawalId=${cancelled.id} publisherUserId=${publisherUserId} ` +
        `amount=${cancelled.amount} balanceAfter=${balanceAfter}`,
    );

    return { ...this.toOutput(cancelled), balanceAfter };
  }

  // ---- Đọc (US2) ----

  async listMine(input: {
    publisherUserId: string;
    query: GetMyWithdrawalsInputType;
  }): Promise<GetMyWithdrawalsOutputType> {
    await this.publisherAccess.assertActivePublisher(input.publisherUserId);

    const { page, pageSize, skip, take } = getPagination(input.query);
    const { rows, totalItems } = await this.withdrawalRepo.listMine({
      publisherUserId: input.publisherUserId,
      skip,
      take,
    });

    return {
      items: rows.map((row) => this.toOutput(row)),
      totalItems,
      page,
      pageSize,
      totalPages: Math.ceil(totalItems / pageSize),
    };
  }

  // Đơn của người khác trả cùng câu trả lời với id không tồn tại.
  async findOne(input: {
    withdrawalId: string;
    publisherUserId: string;
  }): Promise<WithdrawalOutputType> {
    await this.publisherAccess.assertActivePublisher(input.publisherUserId);

    const row = await this.withdrawalRepo.findOneForPublisher(input);
    if (!row) {
      throw WithdrawalNotFoundException;
    }
    return this.toOutput(row);
  }

  // ---- Helper ----

  private toClaim(data: CreateWithdrawalInputType): WithdrawalClaim {
    return {
      amount: BigInt(data.amount),
      bankAccountNumber: data.bankAccountNumber,
      bankName: data.bankName,
      bankAccountHolder: data.bankAccountHolder,
    };
  }

  // Khác bất kỳ trường nào trong bốn ⇒ từ chối: trả đơn cũ khi số tài khoản đã đổi sẽ
  // khiến tiền đi tới nơi người dùng tưởng đã thay.
  private async resolveReplay(
    row: WithdrawalRow,
    claim: WithdrawalClaim,
  ): Promise<WithdrawalMutationOutputType> {
    if (!sameClaim(this.rowToClaim(row), claim)) {
      this.logger.warn(
        `Idempotency key reused with different content withdrawalId=${row.id}`,
      );
      throw WithdrawalIdempotencyKeyReusedException;
    }

    const balanceAfter = await this.withdrawalRepo.findLatestLedgerBalanceAfter(row.id);
    if (balanceAfter === null) {
      // Mọi đơn đều sinh bút toán trong cùng transaction, nên thiếu là bất biến vỡ.
      this.logger.error(`Withdrawal has no ledger entry withdrawalId=${row.id}`);
      throw new Error('Withdrawal without a ledger entry');
    }
    return { ...this.toOutput(row), balanceAfter };
  }

  private rowToClaim(row: WithdrawalRow): WithdrawalClaim {
    return {
      amount: row.amount,
      bankAccountNumber: row.bankAccountNumber,
      bankName: row.bankName,
      bankAccountHolder: row.bankAccountHolder,
    };
  }

  private toOutput(row: WithdrawalRow): WithdrawalOutputType {
    return {
      id: row.id,
      amount: row.amount,
      status: row.status,
      bankAccountNumber: row.bankAccountNumber,
      bankName: row.bankName,
      bankAccountHolder: row.bankAccountHolder,
      bankTransferRef: row.bankTransferRef,
      rejectionReason: row.rejectionReason,
      createdAt: row.createdAt,
      processedAt: row.processedAt,
    };
  }
}
