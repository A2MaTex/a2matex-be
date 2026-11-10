import { Body, Controller, Inject, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActivePermissionScopes } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { MessageResDTO } from '../../shared/dtos/response.dto.ts';
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

  // PUT rather than the repo's POST-as-action convention: the decision is one terminal
  // write per Submission, so replaying the same request is the documented success path.
  @Put(':submissionId/review')
  @ZodResponse({ type: MessageResDTO })
  review(
    @Param() params: SubmissionIdParamDTO,
    @Body() body: ReviewSubmissionInputDTO,
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
