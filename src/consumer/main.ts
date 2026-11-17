import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConsumerModule } from './consumer.module.ts';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(ConsumerModule);
  app.enableShutdownHooks();
}

try {
  await bootstrap();
} catch (error) {
  Logger.error(
    error instanceof Error ? error.message : String(error),
    error instanceof Error ? error.stack : undefined,
    'ConsumerBootstrap',
  );
  process.exit(1);
}
