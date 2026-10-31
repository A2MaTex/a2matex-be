import { Module } from '@nestjs/common';
import { StaticController } from './static.controller.ts';
import { StaticUploadCleanupInterceptor } from './static-upload-cleanup.interceptor.ts';

@Module({
  controllers: [StaticController],
  providers: [StaticUploadCleanupInterceptor],
})
export class StaticModule {}
