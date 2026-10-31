import { Inject, Injectable, Logger } from '@nestjs/common';
import envConfig from '../../shared/config.ts';
import {
  resolveCronSchedule,
  type CronJobDefinition,
  type CronScheduleSource,
} from '../cron-job.interface.ts';
import { StaticService } from '../../shared/services/static.service.ts';

@Injectable()
export class CleanExpiredUploadSessionsJob implements CronJobDefinition {
  readonly name = 'clean-expired-upload-sessions';
  readonly envKey = 'CRON_CLEAN_EXPIRED_UPLOAD_SESSIONS';
  readonly schedule: string;
  readonly scheduleSource: CronScheduleSource;

  private readonly logger = new Logger(CleanExpiredUploadSessionsJob.name);

  constructor(@Inject(StaticService) private readonly staticService: StaticService) {
    // Default = one run per lookback window, the schedule used before the split.
    ({ schedule: this.schedule, scheduleSource: this.scheduleSource } = resolveCronSchedule(
      envConfig.CRON_MULTIPART_CLEAN_TIME,
      envConfig.CRON_MULTIPART_CLEAN_TIME,
    ));
  }

  async run(): Promise<void> {
    try {
      this.logger.debug('Clean Expired Upload Session');
      await this.staticService.cleanExpiredUploadSessions();
    } catch (error) {
      this.logger.error(error);
    }
  }
}
