import { Module } from '@nestjs/common';
import { LauncherReleaseController } from './launcher-release.controller.ts';
import { LauncherReleaseRepo } from './launcher-release.repo.ts';
import { LauncherReleaseService } from './launcher-release.service.ts';

@Module({
  controllers: [LauncherReleaseController],
  providers: [LauncherReleaseService, LauncherReleaseRepo],
})
export class LauncherReleaseModule {}
