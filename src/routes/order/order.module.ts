import { Module } from '@nestjs/common';
import { EntitlementCoreModule } from '../entitlement/entitlement-core.module.ts';
import { OrderController } from './order.controller.ts';
import { OrderRepo } from './order.repo.ts';
import { OrderService } from './order.service.ts';

@Module({
  imports: [EntitlementCoreModule],
  controllers: [OrderController],
  providers: [OrderService, OrderRepo],
})
export class OrderModule {}
