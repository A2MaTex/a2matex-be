import { Body, Controller, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { IsPublic } from '../../shared/decorators/auth.decorator.ts';
import { MessageResDTO } from '../../shared/dtos/response.dto.ts';
import {
  CreateStudioReleaseInputDTO,
  CreateStudioReleaseOutputDTO,
  CurrentStudioReleaseOutputDTO,
  GetStudioReleaseDetailOutputDTO,
  GetStudioReleaseListInputDTO,
  GetStudioReleaseListOutputDTO,
  StudioReleaseIdParamDTO,
  UpdateStudioReleaseInputDTO,
} from './studio-release.dto.ts';
import { StudioReleaseService } from './studio-release.service.ts';

@ApiTags('Studio Releases')
@Controller('studio-releases')
export class StudioReleaseController {
  constructor(
    @Inject(StudioReleaseService) private readonly studioReleaseService: StudioReleaseService,
  ) {}

  @Get('current')
  @IsPublic()
  @ZodResponse({ type: CurrentStudioReleaseOutputDTO })
  getCurrent() {
    return this.studioReleaseService.getCurrent();
  }

  @Get()
  @ApiBearerAuth('access-token')
  @ZodResponse({ type: GetStudioReleaseListOutputDTO })
  getList(@Query() query: GetStudioReleaseListInputDTO) {
    return this.studioReleaseService.getList(query);
  }

  @Get(':studioReleaseId')
  @ApiBearerAuth('access-token')
  @ZodResponse({ type: GetStudioReleaseDetailOutputDTO })
  getDetail(@Param() params: StudioReleaseIdParamDTO) {
    return this.studioReleaseService.getDetail(params.studioReleaseId);
  }

  @Post()
  @ApiBearerAuth('access-token')
  @ZodResponse({ type: CreateStudioReleaseOutputDTO })
  create(@Body() body: CreateStudioReleaseInputDTO, @ActiveUser('userId') userId: string) {
    return this.studioReleaseService.create({ data: body, userId });
  }

  @Put(':studioReleaseId')
  @ApiBearerAuth('access-token')
  @ZodResponse({ type: MessageResDTO })
  update(
    @Param() params: StudioReleaseIdParamDTO,
    @Body() body: UpdateStudioReleaseInputDTO,
    @ActiveUser('userId') userId: string,
  ) {
    return this.studioReleaseService.update({
      id: params.studioReleaseId,
      data: body,
      userId,
    });
  }

  @Put(':studioReleaseId/activate')
  @ApiBearerAuth('access-token')
  @ZodResponse({ type: MessageResDTO })
  activate(@Param() params: StudioReleaseIdParamDTO, @ActiveUser('userId') userId: string) {
    return this.studioReleaseService.activate({ id: params.studioReleaseId, userId });
  }

  @Put(':studioReleaseId/deactivate')
  @ApiBearerAuth('access-token')
  @ZodResponse({ type: MessageResDTO })
  deactivate(@Param() params: StudioReleaseIdParamDTO, @ActiveUser('userId') userId: string) {
    return this.studioReleaseService.deactivate({ id: params.studioReleaseId, userId });
  }
}
