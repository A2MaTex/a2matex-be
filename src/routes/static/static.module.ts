import { Module } from '@nestjs/common';
import { StaticController } from './static.controller.ts';
import { StaticUploadCleanupInterceptor } from './static-upload-cleanup.interceptor.ts';
import { EntitlementModule } from '../entitlement/entitlement.module.ts';
import { SharedModule } from '../../shared/shared.module.ts';

@Module({
  controllers: [StaticController],
  providers: [StaticUploadCleanupInterceptor],
  imports: [EntitlementModule, SharedModule]
})
export class StaticModule {}
