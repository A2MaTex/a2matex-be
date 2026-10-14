import { Body, Controller, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { MessageResDTO } from '../../shared/dtos/response.dto.ts';
import { ActivePermissionScopes } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import {
  CreateProjectInputDTO,
  CreateProjectOutputDTO,
  GetProjectDetailOutputDTO,
  GetProjectListInputDTO,
  GetProjectListOutputDTO,
  ProjectIdParamDTO,
  UpdateProjectInputDTO,
} from './project.dto.ts';
import { ProjectService } from './project.service.ts';

@ApiTags('Projects')
@ApiBearerAuth('access-token')
@Controller('projects')
export class ProjectController {
  constructor(@Inject(ProjectService) private readonly projectService: ProjectService) {}

  @Post()
  @ZodResponse({ type: CreateProjectOutputDTO })
  create(@Body() body: CreateProjectInputDTO, @ActiveUser('userId') userId: string) {
    return this.projectService.create({ data: body, userId });
  }

  @Get()
  @ZodResponse({ type: GetProjectListOutputDTO })
  getList(
    @Query() query: GetProjectListInputDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.projectService.getList({ query, userId, scopes });
  }

  @Get(':projectId')
  @ZodResponse({ type: GetProjectDetailOutputDTO })
  getDetail(
    @Param() params: ProjectIdParamDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.projectService.getDetail({ id: params.projectId, userId, scopes });
  }

  @Put(':projectId')
  @ZodResponse({ type: MessageResDTO })
  update(
    @Param() params: ProjectIdParamDTO,
    @Body() body: UpdateProjectInputDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.projectService.update({ id: params.projectId, data: body, userId, scopes });
  }

  @Put(':projectId/archive')
  @ZodResponse({ type: MessageResDTO })
  archive(
    @Param() params: ProjectIdParamDTO,
    @ActiveUser('userId') userId: string,
    @ActivePermissionScopes() scopes: ActivePermissionScope[],
  ) {
    return this.projectService.archive({ id: params.projectId, userId, scopes });
  }
}
