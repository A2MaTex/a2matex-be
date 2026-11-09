import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { installContextLogger } from '../shared/infrastructure/logging/install-context-logger.ts';
import { ConsumerModule } from './consumer.module.ts';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(ConsumerModule, { bufferLogs: true });
  installContextLogger(app);
  app.enableShutdownHooks();
}

try {
  await bootstrap();
} catch (error) {
  Logger.error(
    error instanceof Error ? error.message : String(error),
    error instanceof Error ? error : undefined,
    'ConsumerBootstrap',
  );
  // bufferLogs holds this record until a logger is attached; a failure before
  // installContextLogger would otherwise exit silently.
  Logger.flush();
  process.exit(1);
}
