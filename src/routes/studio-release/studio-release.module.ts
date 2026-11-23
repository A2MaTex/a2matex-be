import { Module } from '@nestjs/common';
import { StudioReleaseController } from './studio-release.controller.ts';
import { StudioReleaseRepo } from './studio-release.repo.ts';
import { StudioReleaseService } from './studio-release.service.ts';

@Module({
  controllers: [StudioReleaseController],
  providers: [StudioReleaseService, StudioReleaseRepo],
})
export class StudioReleaseModule {}
