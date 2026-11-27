import { Inject, Injectable, Logger } from '@nestjs/common';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import { WalletRepo } from '../wallet/wallet.repo.ts';
import { WalletService } from '../wallet/wallet.service.ts';
import {
  WithdrawalCannotRejectException,
  WithdrawalNotApprovedException,
  WithdrawalNotFoundException,
  WithdrawalNotPendingException,
  WithdrawalProfileNotFoundException,
} from './withdrawal.error.ts';
import type {
  AdminWithdrawalOutputType,
  GetAdminWithdrawalsInputType,
  GetAdminWithdrawalsOutputType,
  WithdrawalMutationOutputType,
} from './withdrawal.model.ts';
import {
  WithdrawalRepo,
  type AdminWithdrawalRow,
  type WithdrawalRow,
} from './withdrawal.repo.ts';

@Injectable()
export class AdminWithdrawalService {
  private readonly logger = new Logger(AdminWithdrawalService.name);

  // Phải đúng tên `transactionService`: @Transactional() đọc nó off instance và ném lỗi lúc
  // chạy nếu thiếu, trong khi build vẫn xanh.
  constructor(
    @Inject(WithdrawalRepo) private readonly withdrawalRepo: WithdrawalRepo,
    @Inject(WalletRepo) private readonly walletRepo: WalletRepo,
    @Inject(WalletService) private readonly walletService: WalletService,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
  ) {}

  // ---- Danh sách ----

  async listAll(query: GetAdminWithdrawalsInputType): Promise<GetAdminWithdrawalsOutputType> {
    const { page, pageSize, skip, take } = getPagination(query);
    const { rows, totalItems } = await this.withdrawalRepo.listForAdmin({
      statuses: query.status,
      skip,
      take,
    });

    return {
      items: rows.map((row) => this.toAdminOutput(row)),
      totalItems,
      page,
      pageSize,
      totalPages: Math.ceil(totalItems / pageSize),
    };
  }

  // ---- Duyệt ----

  // Không transaction và không khoá Profile: duyệt không đụng số dư, nên một câu UPDATE đã
  // là nguyên tử và không có việc thứ hai để gộp vào.
  async approve(input: {
    withdrawalId: string;
    adminUserId: string;
  }): Promise<AdminWithdrawalOutputType> {
    const row = await this.withdrawalRepo.approveIfPending(input);
    if (!row) {
      throw await this.explainFailure(input.withdrawalId, WithdrawalNotPendingException);
    }

    this.logger.log(
      `Withdrawal approved withdrawalId=${row.id} adminUserId=${input.adminUserId} ` +
        `amount=${row.amount}`,
    );
    return this.reload(row.id);
  }

  // ---- Đánh dấu đã chi ----

  async markPaid(input: {
    withdrawalId: string;
    adminUserId: string;
    bankTransferRef: string;
  }): Promise<AdminWithdrawalOutputType> {
    const row = await this.withdrawalRepo.markPaidIfApproved(input);
    if (!row) {
      throw await this.explainFailure(input.withdrawalId, WithdrawalNotApprovedException);
    }

    this.logger.log(
      `Withdrawal marked paid withdrawalId=${row.id} adminUserId=${input.adminUserId} ` +
        `amount=${row.amount} bankTransferRef=${input.bankTransferRef}`,
    );
    return this.reload(row.id);
  }

  // ---- Từ chối ----

  async reject(input: {
    withdrawalId: string;
    adminUserId: string;
    reason: string;
  }): Promise<WithdrawalMutationOutputType> {
    return this.rejectInTransaction(input);
  }

  // Đổi trạng thái và hoàn tiền phải cùng thành công hoặc cùng không.
  @Transactional()
  private async rejectInTransaction(input: {
    withdrawalId: string;
    adminUserId: string;
    reason: string;
  }): Promise<WithdrawalMutationOutputType> {
    const { withdrawalId, adminUserId, reason } = input;

    // Đọc đơn trước CHỈ để biết hoàn vào ví ai, rồi khoá ví đó TRƯỚC khi đổi trạng thái —
    // giữ nguyên thứ tự khoá toàn cục (Profile trước, dòng đơn sau). Đảo lại là tạo chu
    // trình khoá với đường nhà phát hành tự huỷ.
    const existing = await this.withdrawalRepo.findAnyById(withdrawalId);
    if (!existing) {
      throw WithdrawalNotFoundException;
    }

    // Khoá ví trước khi đổi trạng thái: nếu hồ sơ không còn thì phải dừng ở đây, KHÔNG được
    // để đơn thành REJECTED mà tiền không về ví — đó là mất tiền của nhà phát hành.
    const profile = await this.withdrawalRepo.lockPublisherProfile(existing.publisherUserId);
    if (!profile) {
      this.logger.error(
        `Withdrawal reject has no Profile to refund withdrawalId=${withdrawalId} ` +
          `publisherUserId=${existing.publisherUserId}`,
      );
      throw WithdrawalProfileNotFoundException;
    }

    const rejected = await this.withdrawalRepo.rejectIfPendingOrApproved({
      withdrawalId,
      adminUserId,
      reason,
    });
    if (!rejected) {
      throw WithdrawalCannotRejectException;
    }

    const balanceAfter = await this.walletRepo.creditUserBalance({
      userId: rejected.publisherUserId,
      amount: rejected.amount,
    });
    if (balanceAfter === null) {
      // Ví đã khoá ở trên nên không khớp dòng nào là bất biến vỡ.
      this.logger.error(`Withdrawal refund affected no row withdrawalId=${withdrawalId}`);
      throw new Error('Withdrawal refund affected no row');
    }

    // createdById và note là BẮT BUỘC ở đường này. Ràng buộc actor_check không ép được vì
    // nó không nhìn sang được trạng thái đơn để phân biệt với đường nhà phát hành tự huỷ,
    // nên chỗ này là nơi duy nhất đảm bảo điều đó.
    await this.walletService.recordWithdrawalReversal({
      userId: rejected.publisherUserId,
      withdrawalRequestId: rejected.id,
      amount: rejected.amount,
      balanceAfter,
      note: reason,
      createdById: adminUserId,
    });

    this.logger.log(
      `Withdrawal rejected withdrawalId=${rejected.id} adminUserId=${adminUserId} ` +
        `amount=${rejected.amount} balanceAfter=${balanceAfter}`,
    );

    return { ...this.toOutput(rejected), balanceAfter };
  }

  // ---- Helper ----

  // Câu UPDATE khớp 0 dòng. Tính đúng đắn đã xong, phép đọc này chỉ để chọn thông điệp lỗi:
  // đơn không tồn tại là 404, còn tồn tại mà sai trạng thái là xung đột.
  private async explainFailure(withdrawalId: string, conflict: Error): Promise<Error> {
    const existing = await this.withdrawalRepo.findAnyById(withdrawalId);
    if (!existing) {
      throw WithdrawalNotFoundException;
    }
    this.logger.warn(
      `Withdrawal transition refused withdrawalId=${withdrawalId} status=${existing.status}`,
    );
    return conflict;
  }

  // Đọc lại kèm danh tính nhà phát hành, để câu trả lời của DUYỆT và ĐÁNH DẤU CHI có cùng
  // hình dạng với một dòng trong danh sách. Đường TỪ CHỐI cố ý khác: nó trả balanceAfter vì
  // có đổi số dư, và không cần khối publisher.
  private async reload(withdrawalId: string): Promise<AdminWithdrawalOutputType> {
    const found = await this.withdrawalRepo.findOneForAdmin(withdrawalId);
    if (!found) {
      this.logger.error(`Withdrawal disappeared right after a transition id=${withdrawalId}`);
      throw new Error('Withdrawal not readable after transition');
    }
    return this.toAdminOutput(found);
  }

  private toAdminOutput(row: AdminWithdrawalRow): AdminWithdrawalOutputType {
    return {
      ...this.toOutput(row),
      processedById: row.processedById,
      publisher: {
        userId: row.publisherUserId,
        fullName: row.publisher.profile?.fullName ?? '',
        email: row.publisher.email,
      },
    };
  }

  private toOutput(row: WithdrawalRow) {
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
