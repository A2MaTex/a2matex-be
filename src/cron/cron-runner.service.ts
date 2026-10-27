import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob, validateCronExpression } from 'cron';
import envConfig from '../shared/config.ts';
import { CRON_JOBS, CRON_SCHEDULE_OFF, type CronJobDefinition } from './cron-job.interface.ts';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

/**
 * Schedules every CRON_JOBS entry and owns the behaviour shared by all jobs:
 * validation, the `off` switch, run logging, no overlapping runs, bounded drain.
 */
@Injectable()
export class CronRunner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CronRunner.name);
  private readonly cronJobs = new Map<string, CronJob>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    @Inject(CRON_JOBS) private readonly jobs: CronJobDefinition[],
    @Inject(SchedulerRegistry) private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    const seen = new Set<string>();

    for (const job of this.jobs) {
      if (seen.has(job.name)) {
        throw new Error(`Duplicate cron job name "${job.name}"`);
      }
      seen.add(job.name);

      if (job.schedule === CRON_SCHEDULE_OFF) {
        this.logger.log(`disabled name=${job.name} (${job.envKey}=${CRON_SCHEDULE_OFF})`);
        continue;
      }

      const validation = validateCronExpression(job.schedule);
      if (!validation.valid) {
        throw new Error(
          `${job.envKey}="${job.schedule}" is not a valid cron expression: ` +
            `${validation.error?.message ?? 'unknown reason'}`,
        );
      }

      const cronJob = new CronJob(job.schedule, () => void this.execute(job), null, false);
      this.schedulerRegistry.addCronJob(job.name, cronJob);
      this.cronJobs.set(job.name, cronJob);
      cronJob.start();

      this.logger.log(
        `registered name=${job.name} schedule="${job.schedule}" source=${job.scheduleSource} ` +
          `nextRun=${cronJob.nextDate().toISO()}`,
      );
    }
  }

  /** Never rejects: a failing job is logged and must not affect the scheduler or other jobs. */
  async execute(job: CronJobDefinition): Promise<void> {
    if (this.inFlight.has(job.name)) {
      this.logger.warn(
        `skipped name=${job.name} outcome=skipped reason="previous run still in progress"`,
      );
      return;
    }

    const startedAt = Date.now();
    this.logger.log(`started name=${job.name}`);

    const run = Promise.resolve()
      .then(() => job.run())
      .then(
        () => {
          this.logger.log(
            `finished name=${job.name} durationMs=${Date.now() - startedAt} outcome=success`,
          );
        },
        (error: unknown) => {
          this.logger.error(
            `failed name=${job.name} durationMs=${Date.now() - startedAt} outcome=error`,
            error instanceof Error ? error.stack : String(error),
          );
        },
      );

    this.inFlight.set(job.name, run);
    try {
      await run;
    } finally {
      this.inFlight.delete(job.name);
    }
  }

  /**
   * Drains here, not in beforeApplicationShutdown: Nest runs all onModuleDestroy hooks
   * (root module first) before that phase, and SharedModule closes Redis in its own
   * onModuleDestroy. This keeps Redis and Prisma usable for the run still in flight.
   */
  async onModuleDestroy(): Promise<void> {
    for (const cronJob of this.cronJobs.values()) {
      void cronJob.stop();
    }
    this.cronJobs.clear();

    if (this.inFlight.size === 0) {
      this.logger.log('shutdown: no in-flight job');
      return;
    }

    const graceMs = envConfig.CRON_SHUTDOWN_GRACE_SECONDS * 1000;
    this.logger.log(
      `shutdown: waiting for ${this.inFlight.size} in-flight job(s) up to ${graceMs / 1000}s`,
    );

    const finished = await Promise.race([
      Promise.allSettled(this.inFlight.values()).then(() => true),
      sleep(graceMs).then(() => false),
    ]);

    if (finished) {
      this.logger.log('shutdown: all in-flight jobs finished');
      return;
    }
    this.logger.warn(
      `shutdown: grace period exceeded, exiting with ${this.inFlight.size} job(s) still running`,
    );
  }
}
