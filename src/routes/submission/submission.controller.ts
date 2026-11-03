import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActivePermissionScopes } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import {
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKey,
} from '../../shared/decorators/idempotency-key.decorator.ts';
import {
  CreateSubmissionInputDTO,
  CreateSubmissionOutputDTO,
  GetAdminSubmissionListOutputDTO,
  GetSubmissionListInputDTO,
  GetSubmissionListOutputDTO,
  GetSubmissionListResponseDTO,
} from './submission.dto.ts';
import { SubmissionService } from './submission.service.ts';

@ApiTags('Submissions')
@ApiBearerAuth('access-token')
@ApiExtraModels(GetAdminSubmissionListOutputDTO, GetSubmissionListOutputDTO)
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

  @Get()
  @ZodResponse({ type: GetSubmissionListResponseDTO })
  getList(
    @Query() query: GetSubmissionListInputDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.submissionService.getList({ query, userId, scopes });
  }
}
