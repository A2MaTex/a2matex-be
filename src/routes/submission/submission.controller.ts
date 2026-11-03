import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import {
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKey,
} from '../../shared/decorators/idempotency-key.decorator.ts';
import { CreateSubmissionInputDTO, CreateSubmissionOutputDTO } from './submission.dto.ts';
import { SubmissionService } from './submission.service.ts';

@ApiTags('Submissions')
@ApiBearerAuth('access-token')
@Controller('submissions')
export class SubmissionController {
  constructor(@Inject(SubmissionService) private readonly submissionService: SubmissionService) {}

  @Post()
  @ApiHeader({ name: IDEMPOTENCY_KEY_HEADER, required: true, description: 'UUID' })
  @ZodResponse({ type: CreateSubmissionOutputDTO })
  create(
    @Body() body: CreateSubmissionInputDTO,
    @IdempotencyKey('Error.SubmissionIdempotencyKeyRequired') idempotencyKey: string,
    @ActiveUser('userId') userId: string,
  ) {
    return this.submissionService.create({ data: body, idempotencyKey, userId });
  }
}
