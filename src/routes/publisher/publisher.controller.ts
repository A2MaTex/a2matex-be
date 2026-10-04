import { Body, Controller, Get, Inject, Ip, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { SkipPermissionCheck } from '../../shared/decorators/auth.decorator.ts';
import { UserAgent } from '../../shared/decorators/user-agent.decorator.ts';
import { MessageResDTO } from '../../shared/dtos/response.dto.ts';
import {
  ActivatePublisherInputDTO,
  GetMyPublisherOutputDTO,
  GetPublisherListInputDTO,
  GetPublisherListOutputDTO,
  PublisherAccountIdParamDTO,
  PublisherAdminDetailOutputDTO,
  UpdatePublisherStatusInputDTO,
} from './publisher.dto.ts';
import { PublisherService } from './publisher.service.ts';

@ApiTags('Publishers')
@ApiBearerAuth('access-token')
@Controller('publishers')
export class PublisherController {
  constructor(@Inject(PublisherService) private readonly publisherService: PublisherService) {}

  @Get('me')
  @SkipPermissionCheck()
  @ZodResponse({ type: GetMyPublisherOutputDTO })
  getMe(@ActiveUser('userId') userId: string) {
    return this.publisherService.getMe(userId);
  }

  @Post('activate')
  @SkipPermissionCheck()
  @ZodResponse({ type: MessageResDTO })
  activate(
    @Body() body: ActivatePublisherInputDTO,
    @ActiveUser('userId') userId: string,
    @UserAgent() userAgent: string,
    @Ip() ip: string,
  ) {
    return this.publisherService.activate({
      userId,
      data: body,
      context: { ip, userAgent },
    });
  }

  @Get()
  @ZodResponse({ type: GetPublisherListOutputDTO })
  getList(@Query() query: GetPublisherListInputDTO) {
    return this.publisherService.getList(query);
  }

  @Get(':publisherAccountId')
  @ZodResponse({ type: PublisherAdminDetailOutputDTO })
  getDetail(@Param() params: PublisherAccountIdParamDTO) {
    return this.publisherService.getDetail(params.publisherAccountId);
  }

  @Patch(':publisherAccountId/status')
  @ZodResponse({ type: MessageResDTO })
  updateStatus(
    @Param() params: PublisherAccountIdParamDTO,
    @Body() body: UpdatePublisherStatusInputDTO,
    @ActiveUser('userId') userId: string,
  ) {
    return this.publisherService.updateStatus({
      id: params.publisherAccountId,
      data: body,
      actorId: userId,
    });
  }
}
