import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import envConfig from '../../shared/config.ts';
import { SepayApiClient } from './sepay-api.client.ts';
import { TopUpService } from './topup.service.ts';

@Injectable()
/**
 * Actively polls Sepay's own transaction list on a timer so a transfer whose
 * webhook delivery failed is still detected and credited (FR-011, SC-006) —
 * the system does not rely solely on Sepay pushing a notification.
 */
export class TopUpCron {
  private readonly logger = new Logger(TopUpCron.name);

  constructor(
    @Inject(SepayApiClient) private readonly sepayApiClient: SepayApiClient,
    @Inject(TopUpService) private readonly topUpService: TopUpService,
  ) {}

  @Cron(`*/${envConfig.SEPAY_RECONCILE_INTERVAL_MINUTES} * * * *`)
  async reconcile(): Promise<void> {
    const transactions = await this.sepayApiClient.listRecentTransactions(
      envConfig.SEPAY_RECONCILE_INTERVAL_MINUTES,
    );

    for (const transaction of transactions) {
      try {
        await this.topUpService.handleIncomingTransaction(transaction);
      } catch (error) {
        this.logger.error(`Reconciliation failed for transaction ${transaction.id}`, error);
      }
    }
  }
}
