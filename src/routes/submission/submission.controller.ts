import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { MessageResDTO } from '../../shared/dtos/response.dto.ts';
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
  AdminSubmissionDetailOutputDTO,
  SubmissionDetailOutputDTO,
  SubmissionDetailResponseDTO,
  SubmissionIdParamDTO,
} from './submission.dto.ts';
import { SubmissionService } from './submission.service.ts';

@ApiTags('Submissions')
@ApiBearerAuth('access-token')
@ApiExtraModels(
  GetAdminSubmissionListOutputDTO,
  GetSubmissionListOutputDTO,
  AdminSubmissionDetailOutputDTO,
  SubmissionDetailOutputDTO,
)
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

  @Get(':submissionId')
  @ZodResponse({ type: SubmissionDetailResponseDTO })
  getDetail(
    @Param() params: SubmissionIdParamDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.submissionService.getDetail({ submissionId: params.submissionId, userId, scopes });
  }

  // Recovery republishes or re-queues an existing Submission; nothing is created, so
  // this follows the repo's POST-as-action convention rather than defaulting to 201.
  @Post(':submissionId/scan-retry')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: MessageResDTO })
  retryScan(
    @Param() params: SubmissionIdParamDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.submissionService.retryScan({ submissionId: params.submissionId, userId, scopes });
  }
}
