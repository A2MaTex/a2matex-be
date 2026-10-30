import { Module, type Type } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module.ts';
import {
  ConsumerService,
  QUEUE_CONSUMER_HANDLERS,
  type QueueConsumerHandler,
} from './consumer.service.ts';

// Add business handler classes here and import their regular feature modules above.
const handlerTypes: Type<QueueConsumerHandler>[] = [];

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
