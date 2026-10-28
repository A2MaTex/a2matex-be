import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StaticService } from '../../shared/services/static.service.ts';

@Injectable()
/**
 * Actively polls Sepay's own transaction list on a timer so a transfer whose
 * webhook delivery failed is still detected and credited (FR-011, SC-006) —
 * the system does not rely solely on Sepay pushing a notification.
 */
export class TopUpCron {
  private readonly logger = new Logger(TopUpCron.name);

  constructor(@Inject(StaticService) private readonly staticService: StaticService) {}

  @Cron(`0 0 0 * * *`)
  async cleanupIncompleteUploads(): Promise<void> {
    await this.staticService.cleanExpiredUploadSessions();
  }
}
