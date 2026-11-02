import { Inject, Injectable, Logger } from '@nestjs/common';
import type { QueueConsumerHandler } from '../../../consumer/consumer.service.ts';
import { KAFKA_TOPICS } from '../../../shared/constants/kafka.constant.ts';
import type { ConsumedMessage } from '../../../shared/infrastructure/queue/queue.interface.ts';
import { MessageHandlerResult } from '../../../shared/infrastructure/queue/queue.interface.ts';
import { EmailService } from '../../../shared/services/email.service.tsx';
import {
  ADMIN_USER_UNBANNED_EVENT_TYPE,
  AdminUserUnbannedEventPayload,
} from '../user-status.event.ts';

@Injectable()
export class AdminUserUnbanEmailHandler implements QueueConsumerHandler {
  readonly name = AdminUserUnbanEmailHandler.name;
  readonly subscription = {
    topic: KAFKA_TOPICS.USER_UNBANNED_NOTIFICATION,
    groupId: 'user-unbanned-email',
    deadLetterTopic: KAFKA_TOPICS.USER_UNBANNED_NOTIFICATION_DEAD_LETTER,
    maxAttempts: 3,
    retryDelayMs: 1_000,
  };

  private readonly logger = new Logger(AdminUserUnbanEmailHandler.name);

  constructor(@Inject(EmailService) private readonly emailService: EmailService) {}

  async handle(message: ConsumedMessage<unknown>): Promise<MessageHandlerResult> {
    if (message.message.type !== ADMIN_USER_UNBANNED_EVENT_TYPE) {
      return MessageHandlerResult.FAILED;
    }

    const parsed = AdminUserUnbannedEventPayload.safeParse(message.message.payload);
    if (!parsed.success) {
      this.logger.warn(`Invalid user unban email event messageId=${message.message.id}`);
      return MessageHandlerResult.FAILED;
    }

    try {
      const { error } = await this.emailService.sendUserUnbanned({
        email: parsed.data.email,
        username: parsed.data.username,
        status: parsed.data.status,
        reason: parsed.data.reason,
        changedAt: parsed.data.changedAt,
      });
      if (error) {
        this.logger.error(
          `Unban email provider rejected request userId=${parsed.data.userId} messageId=${message.message.id}: ${error.message}`,
        );
        return MessageHandlerResult.RETRY;
      }
      return MessageHandlerResult.SUCCESS;
    } catch (error) {
      this.logger.error(
        `Unban email failed userId=${parsed.data.userId} messageId=${message.message.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      return MessageHandlerResult.RETRY;
    }
  }
}
