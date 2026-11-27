import { Module } from '@nestjs/common';
import { SharedUserRepository } from '../../shared/repositories/shared-user.repo.ts';
import { LauncherController } from './launcher.controller.ts';
import { LauncherRepo } from './launcher.repo.ts';
import { LauncherService } from './launcher.service.ts';

@Module({
  controllers: [LauncherController],
  providers: [LauncherService, LauncherRepo, SharedUserRepository],
})
export class LauncherModule {}
