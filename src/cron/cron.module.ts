import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TopUpCoreModule } from '../routes/topup/topup-core.module.ts';
import { SharedModule } from '../shared/shared.module.ts';
import { CRON_JOBS, type CronJobDefinition } from './cron-job.interface.ts';
import { CronRunner } from './cron-runner.service.ts';
import { TopUpReconcileJob } from './jobs/topup-reconcile.job.ts';
import { StaticCleanJob } from './jobs/static.job.ts';

// No controllers here, and only import modules without controllers (TopUpCoreModule,
// not TopUpModule): anything imported would expose its routes on the cron port.
@Module({
  imports: [ScheduleModule.forRoot(), SharedModule, TopUpCoreModule],
  providers: [
    CronRunner,
    TopUpReconcileJob,
    StaticCleanJob,
    // The single job list: a new job goes into `providers` above and `inject` below.
    {
      provide: CRON_JOBS,
      useFactory: (...jobs: CronJobDefinition[]) => jobs,
      inject: [TopUpReconcileJob, StaticCleanJob],
    },
  ],
})
export class CronModule {}
