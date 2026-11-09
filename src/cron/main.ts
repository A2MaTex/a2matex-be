import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import envConfig from '../shared/config.ts';
import { API_PREFIX } from '../shared/constants/system.constant.ts';
import { installContextLogger } from '../shared/infrastructure/logging/install-context-logger.ts';
import { registerCronHealthRoute } from './cron-health.ts';
import { CronModule } from './cron.module.ts';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(CronModule, { bufferLogs: true });
  installContextLogger(app);

  registerCronHealthRoute(app);
  // SIGTERM -> app.close(): CronRunner drains, then Redis and Prisma disconnect.
  app.enableShutdownHooks();

  const port = Number(envConfig.CRON_PORT);
  await app.listen(port, envConfig.HOST);

  Logger.log(
    `Cron service is running on http://${envConfig.HOST}:${port}/${API_PREFIX}/health`,
    'CronBootstrap',
  );
}

try {
  await bootstrap();
} catch (error) {
  // Invalid CRON_* value or duplicate job name: fail loudly, never fall back silently.
  Logger.error(
    error instanceof Error ? error.message : String(error),
    error instanceof Error ? error : undefined,
    'CronBootstrap',
  );
  // bufferLogs holds this record until a logger is attached; a failure before
  // installContextLogger would otherwise exit silently.
  Logger.flush();
  process.exit(1);
}
