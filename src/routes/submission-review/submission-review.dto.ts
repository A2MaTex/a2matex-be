import { createZodDto } from 'nestjs-zod';
import { ReviewSubmissionInput } from './submission-review.model.ts';

export class ReviewSubmissionInputDTO extends createZodDto(ReviewSubmissionInput) {}
