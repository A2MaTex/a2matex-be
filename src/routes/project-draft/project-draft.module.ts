import { Module } from '@nestjs/common';
import { ProjectModule } from '../project/project.module.ts';
import { ProjectDraftController } from './project-draft.controller.ts';
import { ProjectDraftRepo } from './project-draft.repo.ts';
import { ProjectDraftService } from './project-draft.service.ts';

@Module({
  imports: [ProjectModule],
  controllers: [ProjectDraftController],
  providers: [ProjectDraftService, ProjectDraftRepo],
})
export class ProjectDraftModule {}
