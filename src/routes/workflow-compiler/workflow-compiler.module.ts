import { Module } from '@nestjs/common';
import { WorkflowCompilerController } from './workflow-compiler.controller.ts';
import { WorkflowCompilerRepo } from './workflow-compiler.repo.ts';
import { WorkflowCompilerService } from './workflow-compiler.service.ts';

@Module({
  controllers: [WorkflowCompilerController],
  providers: [WorkflowCompilerService, WorkflowCompilerRepo],
  exports: [WorkflowCompilerService],
})
export class WorkflowCompilerModule {}
