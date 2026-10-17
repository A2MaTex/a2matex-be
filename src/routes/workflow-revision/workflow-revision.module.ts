import { Module } from '@nestjs/common';
import { WorkflowRevisionRepo } from './workflow-revision.repo.ts';
import { WorkflowRevisionService } from './workflow-revision.service.ts';

@Module({
  providers: [WorkflowRevisionService, WorkflowRevisionRepo],
  exports: [WorkflowRevisionService],
})
export class WorkflowRevisionModule {}
