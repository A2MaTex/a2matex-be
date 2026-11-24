import { Module } from '@nestjs/common';
import { EntitlementModule } from '../entitlement/entitlement.module.ts';
import { SystemSettingCoreModule } from '../system-setting/system-setting-core.module.ts';
import { OrderController } from './order.controller.ts';
import { OrderRepo } from './order.repo.ts';
import { OrderService } from './order.service.ts';

// Order depends on Entitlement, never the other way round: a purchase activates access
// through EntitlementService inside its own transaction.
@Module({
  // SystemSettingCoreModule, not SystemSettingModule: the core module carries no
  // controllers, so importing it never exposes admin routes anywhere.
  imports: [EntitlementModule, SystemSettingCoreModule],
  controllers: [OrderController],
  providers: [OrderService, OrderRepo],
})
export class OrderModule {}
