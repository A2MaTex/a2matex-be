import { Module } from '@nestjs/common';
import { AdminEntitlementController } from './admin-entitlement.controller.ts';
import { EntitlementController } from './entitlement.controller.ts';
import { EntitlementRepo } from './entitlement.repo.ts';
import { EntitlementService } from './entitlement.service.ts';

// The Order module imports this one for lockForPurchase/activateFromOrder, so it must
// never import Order back.
@Module({
  controllers: [EntitlementController, AdminEntitlementController],
  providers: [EntitlementService, EntitlementRepo],
  exports: [EntitlementService],
})
export class EntitlementModule {}
