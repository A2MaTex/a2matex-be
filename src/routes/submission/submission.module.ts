import { Module } from '@nestjs/common';
import { ProductModule } from '../product/product.module.ts';
import { PublisherModule } from '../publisher/publisher.module.ts';
import { WorkflowRevisionModule } from '../workflow-revision/workflow-revision.module.ts';
import { SubmissionAccessPolicy } from './submission-access.policy.ts';
import { SubmissionController } from './submission.controller.ts';
import { SubmissionRepo } from './submission.repo.ts';
import { SubmissionService } from './submission.service.ts';

@Module({
  imports: [PublisherModule, ProductModule, WorkflowRevisionModule],
  controllers: [SubmissionController],
  providers: [SubmissionService, SubmissionAccessPolicy, SubmissionRepo],
})
export class SubmissionModule {}
