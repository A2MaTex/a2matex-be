import { Inject, Injectable, Logger } from '@nestjs/common';
import { KAFKA_TOPICS } from '../../shared/constants/kafka.constant.ts';
import {
  PRODUCT_RELEASE_BUILD_CONSUMER_GROUP_ID,
  PRODUCT_RELEASE_BUILD_MAX_ATTEMPTS,
  PRODUCT_RELEASE_BUILD_MESSAGE_TYPE,
  PRODUCT_RELEASE_BUILD_RETRY_DELAY_MS,
} from '../../shared/constants/submission.constant.ts';
import {
  MessageHandlerResult,
  type ConsumedMessage,
  type SubscribeInput,
} from '../../shared/infrastructure/queue/queue.interface.ts';
import type { QueueConsumerHandler } from '../consumer.service.ts';
import { BuildOutcome, ProjectReleaseService } from '../../routes/product-release/services/product-release-build.service.ts';
import { ProductReleaseBuildRequestedPayload } from '../../routes/product-release/product-release-build.model.ts';

@Injectable()
export class ProductReleaseBuildHandler implements QueueConsumerHandler {
  private readonly logger = new Logger(ProductReleaseBuildHandler.name);

  readonly name = 'product-release-build';

  readonly subscription: SubscribeInput = {
    topic: KAFKA_TOPICS.PRODUCT_RELEASE_BUILD_REQUESTED,
    groupId: PRODUCT_RELEASE_BUILD_CONSUMER_GROUP_ID,
    deadLetterTopic: KAFKA_TOPICS.PRODUCT_RELEASE_BUILD_DEAD_LETTER,
    maxAttempts: PRODUCT_RELEASE_BUILD_MAX_ATTEMPTS,
    retryDelayMs: PRODUCT_RELEASE_BUILD_RETRY_DELAY_MS,
  };

  constructor(
    @Inject(ProjectReleaseService) private readonly productReleaseService: ProjectReleaseService,
  ) {}

  async handle(message: ConsumedMessage<unknown>): Promise<MessageHandlerResult> {
    // Nothing is trusted because it arrived from Kafka: a message that does not match
    // the contract can never succeed, so it goes straight to the dead letter topic
    // rather than being retried.
    if (message.message.type !== PRODUCT_RELEASE_BUILD_MESSAGE_TYPE) {
      this.logger.error(`Unexpected message type ${message.message.type} on the build topic`);
      return MessageHandlerResult.FAILED;
    }
    const payload = ProductReleaseBuildRequestedPayload.safeParse(message.message.payload);
    if (!payload.success) {
      this.logger.error(`Malformed build payload messageId=${message.message.id}`);
      return MessageHandlerResult.FAILED;
    }
    // The key orders attempts for one Submission, so a mismatch means the message was
    // assembled wrong and its ordering guarantee does not hold.
    if (message.key !== null && message.key !== payload.data.submissionId) {
      this.logger.error(`build message key does not name its Submission id=${message.message.id}`);
      return MessageHandlerResult.FAILED;
    }

    try {
      const outcome = await this.productReleaseService.build(payload.data);
      // INVALID can never succeed, so it goes straight to the dead letter topic. RETRY is a
      // failed build attempt, tried again up to PRODUCT_RELEASE_BUILD_MAX_ATTEMPTS.
      switch (outcome) {
        case BuildOutcome.COMPLETED:
          return MessageHandlerResult.SUCCESS;
        case BuildOutcome.RETRY:
          return MessageHandlerResult.RETRY;
        default:
          return MessageHandlerResult.FAILED;
      }
    } catch (error) {
      this.logger.error(
        `Product release build failed for submissionId=${payload.data.submissionId} ` +
          `traceId=${message.message.traceId ?? ''}: ` +
          `${error instanceof Error ? error.message : 'unknown'}`,
      );
    //   when failed, retry 3 times
      return MessageHandlerResult.RETRY;
    }
  }
}
