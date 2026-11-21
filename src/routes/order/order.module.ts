import { Module } from '@nestjs/common';
import { EntitlementModule } from '../entitlement/entitlement.module.ts';
import { OrderController } from './order.controller.ts';
import { OrderRepo } from './order.repo.ts';
import { OrderService } from './order.service.ts';

// Order depends on Entitlement, never the other way round: a purchase activates access
// through EntitlementService inside its own transaction.
@Module({
  imports: [EntitlementModule],
  controllers: [OrderController],
  providers: [OrderService, OrderRepo],
})
export class OrderModule {}
