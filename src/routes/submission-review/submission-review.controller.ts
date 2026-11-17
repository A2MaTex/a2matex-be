import { Body, Controller, Inject, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActivePermissionScopes } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { MessageResDTO } from '../../shared/dtos/response.dto.ts';
import CustomZodValidationPipe from '../../shared/pipes/custom-zod-validation.pipe.ts';
import { SubmissionIdParamDTO } from '../submission/submission.dto.ts';
import { ReviewSubmissionInputDTO } from './submission-review.dto.ts';
import { SubmissionReviewService } from './submission-review.service.ts';

@ApiTags('Submissions')
@ApiBearerAuth('access-token')
@Controller('submissions')
export class SubmissionReviewController {
  constructor(
    @Inject(SubmissionReviewService)
    private readonly submissionReviewService: SubmissionReviewService,
  ) {}

  // PUT, not the repo's POST-as-action convention: a replay is a documented success.
  @Put(':submissionId/review')
  @ZodResponse({ type: MessageResDTO })
  review(
    @Param(new CustomZodValidationPipe(SubmissionIdParamDTO)) params: SubmissionIdParamDTO,
    @Body(new CustomZodValidationPipe(ReviewSubmissionInputDTO)) body: ReviewSubmissionInputDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.submissionReviewService.decide({
      submissionId: params.submissionId,
      data: body,
      userId,
      scopes,
    });
  }
}
