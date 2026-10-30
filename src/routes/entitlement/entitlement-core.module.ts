import { Module } from '@nestjs/common';
import { EntitlementRepo } from './entitlement.repo.ts';
import { EntitlementService } from './entitlement.service.ts';

// Entitlement rules without HTTP, so OrderModule can grant inside its own transaction.
@Module({
  providers: [EntitlementService, EntitlementRepo],
  exports: [EntitlementService],
})
export class EntitlementCoreModule {}
