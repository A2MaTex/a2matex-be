import { Body, Controller, Get, Inject, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import {
  AdminUserIdParamDTO,
  GetAdminUserDetailOutputDTO,
  GetAdminUserListInputDTO,
  GetAdminUserListOutputDTO,
  UpdateAdminUserStatusInputDTO,
} from './user.dto.ts';
import { AdminUserService } from './user.service.ts';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { MessageResDTO } from '../../shared/dtos/response.dto.ts';

@ApiTags('User Management')
@ApiBearerAuth('access-token')
@Controller('admin/users')
export class AdminUserController {
  constructor(@Inject(AdminUserService) private readonly adminUserService: AdminUserService) {}

  @Get()
  @ZodResponse({ type: GetAdminUserListOutputDTO })
  getList(@Query() query: GetAdminUserListInputDTO) {
    return this.adminUserService.getList(query);
  }

  @Get(':userId')
  @ZodResponse({ type: GetAdminUserDetailOutputDTO })
  getDetail(@Param() params: AdminUserIdParamDTO) {
    return this.adminUserService.getDetail(params.userId);
  }

  @Put(':userId/status')
  @ZodResponse({ type: MessageResDTO })
  updateStatus(
    @Param() params: AdminUserIdParamDTO,
    @Body() body: UpdateAdminUserStatusInputDTO,
    @ActiveUser('userId') adminUserId: string,
  ) {
    return this.adminUserService.updateStatus({
      userId: params.userId,
      adminUserId,
      data: body,
    });
  }
}
