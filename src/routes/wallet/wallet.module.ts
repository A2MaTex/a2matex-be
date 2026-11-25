import { Module } from '@nestjs/common';
import { WalletCoreModule } from './wallet-core.module.ts';
import { AdminWalletController } from './admin-wallet.controller.ts';
import { WalletController } from './wallet.controller.ts';

// HTTP surface only. Anything that needs to write a ledger entry imports WalletCoreModule
// instead, so these routes never reach the cron process.
@Module({
  imports: [WalletCoreModule],
  controllers: [WalletController, AdminWalletController],
})
export class WalletModule {}
