import { Module } from '@nestjs/common';
import { WorkflowValidationController } from './workflow-validation.controller.ts';
import { WorkflowValidationRepo } from './workflow-validation.repo.ts';
import { WorkflowValidationService } from './workflow-validation.service.ts';

@Module({
  controllers: [WorkflowValidationController],
  providers: [WorkflowValidationService, WorkflowValidationRepo],
})
export class WorkflowValidationModule {}
