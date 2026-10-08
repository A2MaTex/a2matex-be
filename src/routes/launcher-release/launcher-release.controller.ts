import { Body, Controller, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { IsPublic } from '../../shared/decorators/auth.decorator.ts';
import { MessageResDTO } from '../../shared/dtos/response.dto.ts';
import {
  CreateLauncherReleaseInputDTO,
  CreateLauncherReleaseOutputDTO,
  CurrentLauncherReleaseOutputDTO,
  GetLauncherReleaseDetailOutputDTO,
  GetLauncherReleaseListInputDTO,
  GetLauncherReleaseListOutputDTO,
  LauncherReleaseIdParamDTO,
  UpdateLauncherReleaseInputDTO,
} from './launcher-release.dto.ts';
import { LauncherReleaseService } from './launcher-release.service.ts';

@ApiTags('Launcher Releases')
@Controller('launcher-releases')
export class LauncherReleaseController {
  constructor(
    @Inject(LauncherReleaseService) private readonly launcherReleaseService: LauncherReleaseService,
  ) {}

  @Get('current')
  @IsPublic()
  @ZodResponse({ type: CurrentLauncherReleaseOutputDTO })
  getCurrent() {
    return this.launcherReleaseService.getCurrent();
  }

  @Get()
  @ApiBearerAuth('access-token')
  @ZodResponse({ type: GetLauncherReleaseListOutputDTO })
  getList(@Query() query: GetLauncherReleaseListInputDTO) {
    return this.launcherReleaseService.getList(query);
  }

  @Get(':launcherReleaseId')
  @ApiBearerAuth('access-token')
  @ZodResponse({ type: GetLauncherReleaseDetailOutputDTO })
  getDetail(@Param() params: LauncherReleaseIdParamDTO) {
    return this.launcherReleaseService.getDetail(params.launcherReleaseId);
  }

  @Post()
  @ApiBearerAuth('access-token')
  @ZodResponse({ type: CreateLauncherReleaseOutputDTO })
  create(@Body() body: CreateLauncherReleaseInputDTO) {
    return this.launcherReleaseService.create(body);
  }

  @Put(':launcherReleaseId')
  @ApiBearerAuth('access-token')
  @ZodResponse({ type: MessageResDTO })
  update(@Param() params: LauncherReleaseIdParamDTO, @Body() body: UpdateLauncherReleaseInputDTO) {
    return this.launcherReleaseService.update({
      id: params.launcherReleaseId,
      data: body,
    });
  }

  @Put(':launcherReleaseId/activate')
  @ApiBearerAuth('access-token')
  @ZodResponse({ type: MessageResDTO })
  activate(@Param() params: LauncherReleaseIdParamDTO, @ActiveUser('userId') userId: string) {
    return this.launcherReleaseService.activate({ id: params.launcherReleaseId, userId });
  }
}
