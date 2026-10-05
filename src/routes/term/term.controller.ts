import { Body, Controller, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { IsPublic } from '../../shared/decorators/auth.decorator.ts';
import { MessageResDTO } from '../../shared/dtos/response.dto.ts';
import {
  CreateTermInputDTO,
  CreateTermOutputDTO,
  CurrentTermOutputDTO,
  GetCurrentTermInputDTO,
  GetTermDetailOutputDTO,
  GetTermListInputDTO,
  GetTermListOutputDTO,
  TermIdParamDTO,
  UpdateTermInputDTO,
  UpdateTermStatusInputDTO,
} from './term.dto.ts';
import { TermService } from './term.service.ts';

@ApiTags('Terms')
@Controller('terms')
export class TermController {
  constructor(@Inject(TermService) private readonly termService: TermService) {}

  @Get('current')
  @IsPublic()
  @ZodResponse({ type: CurrentTermOutputDTO })
  getCurrent(@Query() query: GetCurrentTermInputDTO) {
    return this.termService.getCurrent(query);
  }

  @Get()
  @ApiBearerAuth('access-token')
  @ZodResponse({ type: GetTermListOutputDTO })
  getList(@Query() query: GetTermListInputDTO) {
    return this.termService.getList(query);
  }

  @Get(':termId')
  @ApiBearerAuth('access-token')
  @ZodResponse({ type: GetTermDetailOutputDTO })
  getDetail(@Param() params: TermIdParamDTO) {
    return this.termService.getDetail(params.termId);
  }

  @Post()
  @ApiBearerAuth('access-token')
  @ZodResponse({ type: CreateTermOutputDTO })
  create(@Body() body: CreateTermInputDTO, @ActiveUser('userId') userId: string) {
    return this.termService.create({ data: body, userId });
  }

  @Put(':termId')
  @ApiBearerAuth('access-token')
  @ZodResponse({ type: MessageResDTO })
  update(
    @Param() params: TermIdParamDTO,
    @Body() body: UpdateTermInputDTO,
    @ActiveUser('userId') userId: string,
  ) {
    return this.termService.update({ id: params.termId, data: body, userId });
  }

  @Put(':termId/status')
  @ApiBearerAuth('access-token')
  @ZodResponse({ type: MessageResDTO })
  updateStatus(
    @Param() params: TermIdParamDTO,
    @Body() body: UpdateTermStatusInputDTO,
    @ActiveUser('userId') userId: string,
  ) {
    return this.termService.updateStatus({ id: params.termId, data: body, userId });
  }
}
