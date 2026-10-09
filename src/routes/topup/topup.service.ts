import { randomInt } from 'node:crypto';
import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import envConfig from '../../shared/config.ts';
import { DistributedLock } from '../../shared/decorators/distributed-lock.decorator.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { CACHE_PROVIDER } from '../../shared/infrastructure/cache/cache.interface.ts';
import type { CacheProvider } from '../../shared/infrastructure/cache/cache.interface.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import { isUniqueConstraintPrismaError } from '../../shared/utils/prisma.ts';
import type { SepayWebhookPayloadType } from './topup.model.ts';
import { TopUpRepo } from './topup.repo.ts';

const REFERENCE_CODE_LENGTH = 8;
const REFERENCE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_REFERENCE_CODE_RETRIES = 5;
const SEPAY_INCOMING_TRANSFER_TYPE = 'in';

@Injectable()
export class TopUpService {
  private readonly logger = new Logger(TopUpService.name);

  constructor(
    @Inject(TopUpRepo) private readonly topUpRepo: TopUpRepo,
    @Inject(CACHE_PROVIDER) private readonly cacheProvider: CacheProvider,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
  ) {}

  async createTopUpRequest({ userId, amount }: { userId: string; amount: number }) {
    const bankTransferConfig = this.getBankTransferConfig();
    const referenceCode = await this.createPendingRequestWithUniqueCode({
      userId,
      requestedAmount: BigInt(amount),
    });

    return {
      referenceCode,
      amount,
      ...bankTransferConfig,
      transferContent: referenceCode,
    };
  }

  private getBankTransferConfig() {
    const bankAccountNumber = envConfig.SEPAY_BANK_ACCOUNT_NUMBER;
    const bankName = envConfig.SEPAY_BANK_NAME;
    const accountHolderName = envConfig.SEPAY_BANK_ACCOUNT_HOLDER;

    if (!bankAccountNumber || !bankName || !accountHolderName) {
      this.logger.error('Sepay bank transfer configuration is incomplete');
      throw new ServiceUnavailableException('Error.SepayBankTransferNotConfigured');
    }

    return {
      bankAccountNumber,
      bankName,
      accountHolderName,
    };
  }

  private async createPendingRequestWithUniqueCode({
    userId,
    requestedAmount,
  }: {
    userId: string;
    requestedAmount: bigint;
  }): Promise<string> {
    for (let attempt = 0; attempt < MAX_REFERENCE_CODE_RETRIES; attempt++) {
      const referenceCode = this.buildReferenceCodeCandidate();
      try {
        await this.topUpRepo.createPendingRequest({ userId, referenceCode, requestedAmount });
        return referenceCode;
      } catch (error) {
        if (!isUniqueConstraintPrismaError(error)) {
          throw error;
        }
      }
    }
    throw new Error('Unable to generate a unique top-up reference code');
  }

  private buildReferenceCodeCandidate(): string {
    let code = '';
    for (let i = 0; i < REFERENCE_CODE_LENGTH; i++) {
      code += REFERENCE_CODE_ALPHABET[randomInt(REFERENCE_CODE_ALPHABET.length)];
    }
    return code;
  }

  @DistributedLock({
    useCase: 'topup_incoming_transaction',
    resource: (payload: SepayWebhookPayloadType) => payload.id,
  })
  async handleIncomingTransaction(payload: SepayWebhookPayloadType): Promise<void> {
    if (payload.transferType !== SEPAY_INCOMING_TRANSFER_TYPE) {
      return;
    }

    const existing = await this.topUpRepo.findByProviderTransactionId(payload.id);
    if (existing) {
      return;
    }

    const receivedAmount = BigInt(payload.transferAmount);
    const matched = await this.findPendingRequestInContent(payload.content);

    if (matched) {
      await this.creditTopUp({
        topUpTransactionId: matched.id,
        userId: matched.userId as string,
        receivedAmount,
        providerTransactionId: payload.id,
        rawContent: payload.content,
      });
      return;
    }

    await this.topUpRepo.createUnmatched({
      receivedAmount,
      providerTransactionId: payload.id,
      rawContent: payload.content,
    });
  }

  private async findPendingRequestInContent(content: string) {
    const candidateCodes = content.toUpperCase().match(/[A-Z0-9]{8}/g);

    if (!candidateCodes) {
      return null;
    }

    for (const code of candidateCodes) {
      const pending = await this.topUpRepo.findPendingByReferenceCode(code);
      if (pending) {
        return pending;
      }
    }
    return null;
  }

  @Transactional()
  private async creditTopUp({
    topUpTransactionId,
    userId,
    receivedAmount,
    providerTransactionId,
    rawContent,
  }: {
    topUpTransactionId: string;
    userId: string;
    receivedAmount: bigint;
    providerTransactionId: string;
    rawContent: string;
  }): Promise<void> {
    await this.topUpRepo.markCredited({
      topUpTransactionId,
      receivedAmount,
      providerTransactionId,
      rawContent,
    });
    await this.topUpRepo.incrementProfileBalance({ userId, amount: receivedAmount });
  }
}
