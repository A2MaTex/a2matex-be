import { Module } from '@nestjs/common';
import { SystemSettingCoreModule } from '../system-setting/system-setting-core.module.ts';
import { SepayApiClient } from './sepay-api.client.ts';
import { TopUpRepo } from './topup.repo.ts';
import { TopUpService } from './topup.service.ts';

// Top-up logic without HTTP, shared by TopUpModule (API) and CronModule.
@Module({
  // Core, not SystemSettingModule: CronModule imports this module, and a module with
  // controllers would serve its routes on the cron port.
  imports: [SystemSettingCoreModule],
  providers: [TopUpService, TopUpRepo, SepayApiClient],
  exports: [TopUpService, SepayApiClient],
})
export class TopUpCoreModule {}
