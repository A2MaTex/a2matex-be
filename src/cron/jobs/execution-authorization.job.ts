import { Inject, Injectable } from '@nestjs/common';
import envConfig from '../../shared/config.ts';
import { EXECUTION_AUTHORIZATION_CLEANUP_SCHEDULE } from '../../shared/constants/execution-authorization.constant.ts';
import { ExecutionAuthorizationUnavailableException } from '../../routes/execution-authorization/execution-authorization.error.ts';
import { ExecutionAuthorizationRepo } from '../../routes/execution-authorization/execution-authorization.repo.ts';
import {
  resolveCronSchedule,
  type CronJobDefinition,
  type CronScheduleSource,
} from '../cron-job.interface.ts';

@Injectable()
export class CleanExecutionAuthorizationRequestsJob implements CronJobDefinition {
  readonly name = 'clean-execution-authorization-requests';
  readonly envKey = 'CRON_EXECUTION_AUTHORIZATION_CLEANUP';
  readonly schedule: string;
  readonly scheduleSource: CronScheduleSource;
  constructor(
    @Inject(ExecutionAuthorizationRepo) private readonly repo: ExecutionAuthorizationRepo,
  ) {
    ({ schedule: this.schedule, scheduleSource: this.scheduleSource } = resolveCronSchedule(
      envConfig.CRON_EXECUTION_AUTHORIZATION_CLEANUP,
      EXECUTION_AUTHORIZATION_CLEANUP_SCHEDULE,
    ));
  }
  async run(): Promise<void> {
    try {
      await this.repo.cleanExpiredReceipts();
    } catch {
      throw ExecutionAuthorizationUnavailableException;
    }
  }
}
