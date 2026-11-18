import { Module, type Type } from '@nestjs/common';
import { SubmissionScanModule } from '../routes/submission/scan/submission-scan.module.ts';
import { SharedModule } from '../shared/shared.module.ts';
import { SubmissionScanHandler } from './handlers/submission-scan.handler.ts';
import {
  ConsumerService,
  QUEUE_CONSUMER_HANDLERS,
  type QueueConsumerHandler,
} from './consumer.service.ts';
import { ProductReleaseModule } from '../routes/product-release/product-release.module.ts';
import { ProductReleaseBuildHandler } from './handlers/product-release-build.handle.ts';

// Add business handler classes here and import the module that exports the service
// each one calls. Handlers live in this module because they are transport adapters:
// the feature module they reach into must not know a queue delivers its work.
const handlerTypes: Type<QueueConsumerHandler>[] = [
  SubmissionScanHandler,
  ProductReleaseBuildHandler,
];

@Module({
  imports: [SharedModule, SubmissionScanModule, ProductReleaseModule],
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
