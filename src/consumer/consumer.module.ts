import { Module, type Type } from '@nestjs/common';
import { SubmissionScanModule } from '../routes/submission/scan/submission-scan.module.ts';
import { SharedModule } from '../shared/shared.module.ts';
import { SubmissionScanConsumer } from '../routes/submission/scan/submission-scan.consumer.ts';
import {
  ConsumerService,
  QUEUE_CONSUMER_HANDLERS,
  type QueueConsumerHandler,
} from './consumer.service.ts';

// Add business handler classes here and import the module that provides each one.
// Handlers are not declared as providers of this module: they belong to their own
// feature module, which is what gives them their dependencies.
const handlerTypes: Type<QueueConsumerHandler>[] = [SubmissionScanConsumer];

@Module({
  imports: [SharedModule, SubmissionScanModule],
  providers: [
    ConsumerService,
    {
      provide: QUEUE_CONSUMER_HANDLERS,
      inject: handlerTypes,
      useFactory: (...handlers: QueueConsumerHandler[]) => handlers,
    },
  ],
})
export class ConsumerModule {}
