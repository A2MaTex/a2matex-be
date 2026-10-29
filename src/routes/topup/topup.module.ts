import { Module } from '@nestjs/common';
import { SepayWebhookGuard } from './sepay-webhook.guard.ts';
import { TopUpController } from './topup.controller.ts';
import { TopUpCoreModule } from './topup-core.module.ts';

// HTTP surface only; the reconciliation job runs in src/cron/jobs/topup-reconcile.job.ts.
@Module({
  imports: [TopUpCoreModule],
  providers: [SepayWebhookGuard],
  controllers: [TopUpController],
})
export class TopUpModule {}
