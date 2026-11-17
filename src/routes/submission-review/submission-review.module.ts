import { Module } from '@nestjs/common';
import { SubmissionReviewController } from './submission-review.controller.ts';
import { SubmissionReviewRepo } from './submission-review.repo.ts';
import { SubmissionReviewService } from './submission-review.service.ts';

@Module({
  controllers: [SubmissionReviewController],
  providers: [SubmissionReviewService, SubmissionReviewRepo],
})
export class SubmissionReviewModule {}
