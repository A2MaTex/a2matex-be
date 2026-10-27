import { Inject, Injectable, Logger } from '@nestjs/common';
import { SepayApiClient } from '../../routes/topup/sepay-api.client.ts';
import { TopUpService } from '../../routes/topup/topup.service.ts';
import envConfig from '../../shared/config.ts';
import {
  resolveCronSchedule,
  type CronJobDefinition,
  type CronScheduleSource,
} from '../cron-job.interface.ts';

/**
 * Polls Sepay's transaction list so a transfer whose webhook never arrived is still
 * credited (spec 002 FR-011). Idempotent: TopUpService never credits a provider
 * transaction twice.
 */
@Injectable()
export class TopUpReconcileJob implements CronJobDefinition {
  readonly name = 'topup-reconcile';
  readonly envKey = 'CRON_TOPUP_RECONCILE';
  readonly schedule: string;
  readonly scheduleSource: CronScheduleSource;

  private readonly logger = new Logger(TopUpReconcileJob.name);

  constructor(
    @Inject(SepayApiClient) private readonly sepayApiClient: SepayApiClient,
    @Inject(TopUpService) private readonly topUpService: TopUpService,
  ) {
    // Default = one run per lookback window, the schedule used before the split.
    ({ schedule: this.schedule, scheduleSource: this.scheduleSource } = resolveCronSchedule(
      envConfig.CRON_TOPUP_RECONCILE,
      `*/${envConfig.SEPAY_RECONCILE_INTERVAL_MINUTES} * * * *`,
    ));
  }

  async run(): Promise<void> {
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
