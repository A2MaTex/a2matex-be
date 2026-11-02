import { Module, type Type } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module.ts';
import {
  ConsumerService,
  QUEUE_CONSUMER_HANDLERS,
  type QueueConsumerHandler,
} from './consumer.service.ts';
import { AdminUserBanEmailHandler } from '../routes/user/email/user-ban-email.handler.ts';
import { AdminUserUnbanEmailHandler } from '../routes/user/email/user-unban-email.handler.ts';

// Add business handler classes here and import their regular feature modules above.
const handlerTypes: Type<QueueConsumerHandler>[] = [
  AdminUserBanEmailHandler,
  AdminUserUnbanEmailHandler,
];

@Module({
  imports: [SharedModule],
  providers: [
    ...handlerTypes,
    ConsumerService,
    {
      provide: QUEUE_CONSUMER_HANDLERS,
      inject: handlerTypes,
      useFactory: (...handlers: QueueConsumerHandler[]) => handlers,
    },
  ],
})
export class ConsumerModule {}
