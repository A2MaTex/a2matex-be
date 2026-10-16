import { Module } from '@nestjs/common';
import { ProjectController } from './project.controller.ts';
import { ProjectRepo } from './project.repo.ts';
import { ProjectService } from './project.service.ts';

@Module({
  controllers: [ProjectController],
  providers: [ProjectService, ProjectRepo],
})
export class ProjectModule {}
