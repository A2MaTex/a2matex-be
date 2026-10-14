import { Body, Controller, Get, Inject, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActivePermissionScopes } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import CustomZodValidationPipe from '../../shared/pipes/custom-zod-validation.pipe.ts';
import { ProjectIdParamDTO } from '../project/project.dto.ts';
import {
  GetProjectDraftOutputDTO,
  ProjectDraftSyncOutputDTO,
  SaveProjectDraftInputDTO,
} from './project-draft.dto.ts';
import { ProjectDraftService } from './project-draft.service.ts';

@ApiTags('Project Drafts')
@ApiBearerAuth('access-token')
@Controller('projects/:projectId/draft')
export class ProjectDraftController {
  constructor(
    @Inject(ProjectDraftService) private readonly projectDraftService: ProjectDraftService,
  ) {}

  @Get()
  @ZodResponse({ type: GetProjectDraftOutputDTO })
  get(
    @Param(new CustomZodValidationPipe(ProjectIdParamDTO)) params: ProjectIdParamDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.projectDraftService.get({ projectId: params.projectId, userId, scopes });
  }

  @Put()
  @ZodResponse({ type: ProjectDraftSyncOutputDTO })
  save(
    @Param(new CustomZodValidationPipe(ProjectIdParamDTO)) params: ProjectIdParamDTO,
    @Body(new CustomZodValidationPipe(SaveProjectDraftInputDTO)) body: SaveProjectDraftInputDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.projectDraftService.save({
      projectId: params.projectId,
      data: body,
      userId,
      scopes,
    });
  }
}
