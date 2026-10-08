import { Module } from '@nestjs/common';
import { SepayApiClient } from './sepay-api.client.ts';
import { SepayWebhookGuard } from './sepay-webhook.guard.ts';
import { TopUpController } from './topup.controller.ts';
import { TopUpCron } from './topup.cron.ts';
import { TopUpRepo } from './topup.repo.ts';
import { TopUpService } from './topup.service.ts';

@Module({
  providers: [TopUpService, TopUpRepo, SepayWebhookGuard, SepayApiClient, TopUpCron],
  controllers: [TopUpController],
})
export class TopUpModule {}
