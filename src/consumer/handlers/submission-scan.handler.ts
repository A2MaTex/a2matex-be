import { Inject, Injectable, Logger } from '@nestjs/common';
import { KAFKA_TOPICS } from '../../shared/constants/kafka.constant.ts';
import {
  SUBMISSION_SCAN_CONSUMER_GROUP_ID,
  SUBMISSION_SCAN_MAX_ATTEMPTS,
  SUBMISSION_SCAN_MESSAGE_TYPE,
  SUBMISSION_SCAN_RETRY_DELAY_MS,
} from '../../shared/constants/submission.constant.ts';
import {
  MessageHandlerResult,
  type ConsumedMessage,
  type SubscribeInput,
} from '../../shared/infrastructure/queue/queue.interface.ts';
import { SubmissionScanRequestedPayload } from '../../routes/submission/scan/submission-scan.model.ts';
import {
  ScanOutcome,
  SubmissionScanService,
} from '../../routes/submission/scan/submission-scan.service.ts';
import type { QueueConsumerHandler } from '../consumer.service.ts';

@Injectable()
export class SubmissionScanHandler implements QueueConsumerHandler {
  private readonly logger = new Logger(SubmissionScanHandler.name);

  readonly name = 'submission-scan';

  readonly subscription: SubscribeInput = {
    topic: KAFKA_TOPICS.SUBMISSION_SCAN_REQUESTED,
    groupId: SUBMISSION_SCAN_CONSUMER_GROUP_ID,
    deadLetterTopic: KAFKA_TOPICS.SUBMISSION_SCAN_DEAD_LETTER,
    maxAttempts: SUBMISSION_SCAN_MAX_ATTEMPTS,
    retryDelayMs: SUBMISSION_SCAN_RETRY_DELAY_MS,
  };

  constructor(
    @Inject(SubmissionScanService) private readonly submissionScanService: SubmissionScanService,
  ) {}

  async handle(message: ConsumedMessage<unknown>): Promise<MessageHandlerResult> {
    // Nothing is trusted because it arrived from Kafka: a message that does not match
    // the contract can never succeed, so it goes straight to the dead letter topic
    // rather than being retried.
    if (message.message.type !== SUBMISSION_SCAN_MESSAGE_TYPE) {
      this.logger.error(`Unexpected message type ${message.message.type} on the scan topic`);
      return MessageHandlerResult.FAILED;
    }
    const payload = SubmissionScanRequestedPayload.safeParse(message.message.payload);
    if (!payload.success) {
      this.logger.error(`Malformed scan payload messageId=${message.message.id}`);
      return MessageHandlerResult.FAILED;
    }
    // The key orders attempts for one Submission, so a mismatch means the message was
    // assembled wrong and its ordering guarantee does not hold.
    if (message.key !== null && message.key !== payload.data.submissionId) {
      this.logger.error(`Scan message key does not name its Submission id=${message.message.id}`);
      return MessageHandlerResult.FAILED;
    }

    try {
      const outcome = await this.submissionScanService.run(payload.data);
      // Business-invalid content is a successful scan: retrying it would only produce
      // the same findings, and the Admin decides what they mean.
      return outcome === ScanOutcome.INVALID
        ? MessageHandlerResult.FAILED
        : MessageHandlerResult.SUCCESS;
    } catch (error) {
      this.logger.error(
        `Submission scan failed submissionId=${payload.data.submissionId} ` +
          `scanAttempt=${payload.data.scanAttempt} traceId=${message.message.traceId ?? ''}: ` +
          `${error instanceof Error ? error.message : 'unknown'}`,
      );
      await this.submissionScanService.markTechnicalFailure(payload.data);
      return MessageHandlerResult.RETRY;
    }
  }
}
