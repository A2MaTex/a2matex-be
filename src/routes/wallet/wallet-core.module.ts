import { Module } from '@nestjs/common';
import { AdminWalletService } from './admin-wallet.service.ts';
import { WalletRepo } from './wallet.repo.ts';
import { WalletService } from './wallet.service.ts';

// No controllers here. TopUpCoreModule imports this module to record its ledger entries,
// and CronModule imports TopUpCoreModule — anything with controllers that gets pulled in
// along that path would serve its routes on the cron port (see src/cron/cron.module.ts).
@Module({
  providers: [WalletService, AdminWalletService, WalletRepo],
  exports: [WalletService, AdminWalletService, WalletRepo],
})
export class WalletCoreModule {}
