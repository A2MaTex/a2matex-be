import { Module } from '@nestjs/common';
import { StaticController } from './static.controller.ts';
import { StaticUploadCleanupInterceptor } from './static-upload-cleanup.interceptor.ts';
import { UploadSessionCron } from './static.cron.ts';

@Module({
  controllers: [StaticController],
  providers: [StaticUploadCleanupInterceptor, UploadSessionCron],
})
export class StaticModule {}
