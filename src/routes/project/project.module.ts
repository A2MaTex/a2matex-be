import { Module } from '@nestjs/common';
import { ProjectAccessPolicy } from './project-access.policy.ts';
import { ProjectController } from './project.controller.ts';
import { ProjectRepo } from './project.repo.ts';
import { ProjectService } from './project.service.ts';

@Module({
  controllers: [ProjectController],
  providers: [ProjectService, ProjectAccessPolicy, ProjectRepo],
  exports: [ProjectAccessPolicy],
})
export class ProjectModule {}
