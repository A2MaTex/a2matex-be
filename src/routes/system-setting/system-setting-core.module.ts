import { Module } from '@nestjs/common';
import { SystemSettingRepo } from './system-setting.repo.ts';
import { SystemSettingService } from './system-setting.service.ts';

// No controllers here. CronModule reaches this module through TopUpCoreModule, and
// anything with controllers that gets imported there would serve its routes on the cron
// port (see src/cron/cron.module.ts).
@Module({
  providers: [SystemSettingService, SystemSettingRepo],
  exports: [SystemSettingService],
})
export class SystemSettingCoreModule {}
