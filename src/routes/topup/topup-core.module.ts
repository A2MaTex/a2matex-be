import { Module } from '@nestjs/common';
import { SepayApiClient } from './sepay-api.client.ts';
import { TopUpRepo } from './topup.repo.ts';
import { TopUpService } from './topup.service.ts';

// Top-up logic without HTTP, shared by TopUpModule (API) and CronModule.
@Module({
  providers: [TopUpService, TopUpRepo, SepayApiClient],
  exports: [TopUpService, SepayApiClient],
})
export class TopUpCoreModule {}
