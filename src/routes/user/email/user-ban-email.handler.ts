import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConsumedMessage } from '../../../shared/infrastructure/queue/queue.interface.ts';
import { MessageHandlerResult } from '../../../shared/infrastructure/queue/queue.interface.ts';
import { KAFKA_TOPICS } from '../../../shared/constants/kafka.constant.ts';
import { EmailService } from '../../../shared/services/email.service.tsx';
import type { QueueConsumerHandler } from '../../../consumer/consumer.service.ts';
import {
  ADMIN_USER_BANNED_EVENT_TYPE,
  AdminUserBannedEventPayload,
} from '../user-status.event.ts';

@Injectable()
export class AdminUserBanEmailHandler implements QueueConsumerHandler {
  readonly name = AdminUserBanEmailHandler.name;
  readonly subscription = {
    topic: KAFKA_TOPICS.USER_BANNED_NOTIFICATION,
    groupId: 'user-banned-email',
    deadLetterTopic: KAFKA_TOPICS.USER_BANNED_NOTIFICATION_DEAD_LETTER,
    maxAttempts: 3,
    retryDelayMs: 1_000,
  };

  private readonly logger = new Logger(AdminUserBanEmailHandler.name);

  constructor(@Inject(EmailService) private readonly emailService: EmailService) {}

  async handle(message: ConsumedMessage<unknown>): Promise<MessageHandlerResult> {
    if (message.message.type !== ADMIN_USER_BANNED_EVENT_TYPE) {
      return MessageHandlerResult.FAILED;
    }

    const parsed = AdminUserBannedEventPayload.safeParse(message.message.payload);
    if (!parsed.success) {
      this.logger.warn(`Invalid user ban email event messageId=${message.message.id}`);
      return MessageHandlerResult.FAILED;
    }

    try {
      const { error } = await this.emailService.sendUserBanned({
        email: parsed.data.email,
        username: parsed.data.username,
        reason: parsed.data.reason,
        changedAt: parsed.data.changedAt,
      });
      if (error) {
        this.logger.error(
          `Ban email provider rejected request userId=${parsed.data.userId} messageId=${message.message.id}: ${error.message}`,
        );
        return MessageHandlerResult.RETRY;
      }
      return MessageHandlerResult.SUCCESS;
    } catch (error) {
      this.logger.error(
        `Ban email failed userId=${parsed.data.userId} messageId=${message.message.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      return MessageHandlerResult.RETRY;
    }
  }
}
