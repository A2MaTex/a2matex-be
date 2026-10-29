/** Multi-provider token holding the single list of jobs (see cron.module.ts). */
export const CRON_JOBS = Symbol('CRON_JOBS');

/** `CRON_<JOB>=off` disables a job instead of scheduling it. */
export const CRON_SCHEDULE_OFF = 'off';

export type CronScheduleSource = 'env' | 'default';

export interface CronJobDefinition {
  /** Unique kebab-case id, used in logs and the scheduler registry. */
  readonly name: string;
  /** Env variable that overrides the schedule, e.g. `CRON_TOPUP_RECONCILE`. */
  readonly envKey: string;
  /** 5-field cron expression, or `CRON_SCHEDULE_OFF`. */
  readonly schedule: string;
  readonly scheduleSource: CronScheduleSource;
  /** Must be idempotent: there is no distributed lock, a restart can repeat a period. */
  run(): Promise<void>;
}

/**
 * Env override wins over the job default; `off` (any case) means disabled.
 * Syntax is checked by CronRunner at bootstrap so a bad value only stops the cron
 * process, never the API that shares the same config schema.
 */
export function resolveCronSchedule(
  override: string | undefined,
  fallback: string,
): Pick<CronJobDefinition, 'schedule' | 'scheduleSource'> {
  const trimmed = override?.trim();
  if (!trimmed) {
    return { schedule: fallback, scheduleSource: 'default' };
  }
  const schedule = trimmed.toLowerCase() === CRON_SCHEDULE_OFF ? CRON_SCHEDULE_OFF : trimmed;
  return { schedule, scheduleSource: 'env' };
}
