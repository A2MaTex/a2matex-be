import { Module } from '@nestjs/common';
import { PublisherModule } from '../publisher/publisher.module.ts';
import { SystemSettingCoreModule } from '../system-setting/system-setting-core.module.ts';
import { WalletCoreModule } from '../wallet/wallet-core.module.ts';
import { WithdrawalController } from './withdrawal.controller.ts';
import { WithdrawalRepo } from './withdrawal.repo.ts';
import { WithdrawalService } from './withdrawal.service.ts';

// Bản *CoreModule không mang controller, nên import nó không phơi route quản trị ở nơi
// khác. Cùng lý do OrderModule dùng chúng.
@Module({
  imports: [PublisherModule, WalletCoreModule, SystemSettingCoreModule],
  controllers: [WithdrawalController],
  providers: [WithdrawalService, WithdrawalRepo],
})
export class WithdrawalModule {}
