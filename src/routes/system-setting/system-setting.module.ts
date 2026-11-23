import { Module } from '@nestjs/common';
import { SystemSettingController } from './system-setting.controller.ts';
import { SystemSettingCoreModule } from './system-setting-core.module.ts';

// HTTP surface only. Anything that needs to read a setting imports SystemSettingCoreModule
// instead, so the admin routes never reach the cron process.
@Module({
  imports: [SystemSettingCoreModule],
  controllers: [SystemSettingController],
})
export class SystemSettingModule {}
