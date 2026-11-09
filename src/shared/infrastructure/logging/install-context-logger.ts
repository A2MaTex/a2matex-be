import type { INestApplicationContext } from '@nestjs/common';
import { ContextLoggerService } from './context-logger.service.ts';

/**
 * Every entry point installs the same logger, so sanitizing and the structured
 * record shape are identical in the API, cron, and consumer processes.
 */
export function installContextLogger(app: INestApplicationContext): void {
  app.useLogger(app.get(ContextLoggerService));
}
