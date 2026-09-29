import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { MessageResDTO } from '../../shared/dtos/response.dto.ts';
import {
  CreateRoleInputDTO,
  CreateRoleOutputDTO,
  DeleteManyRoleInputDTO,
  GetRoleDetailOutputDTO,
  GetRoleListInputDTO,
  GetRoleListOutputDTO,
  GetRolePermissionsOutputDTO,
  RoleIdParamDTO,
  UpdateRoleInputDTO,
  UpdateRolePermissionsInputDTO,
} from './role.dto.ts';
import { RoleService } from './role.service.ts';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('Roles')
@ApiBearerAuth('access-token')
@Controller('roles')
export class RoleController {
  constructor(@Inject(RoleService) private readonly roleService: RoleService) {}

  @Post()
  @ZodResponse({ type: CreateRoleOutputDTO })
  create(@Body() body: CreateRoleInputDTO, @ActiveUser('userId') userId: string) {
    return this.roleService.create({
      data: body,
      createdById: userId,
    });
  }

  @Get()
  @ZodResponse({ type: GetRoleListOutputDTO })
  getList(@Query() query: GetRoleListInputDTO) {
    return this.roleService.getList(query);
  }

  @Get(':roleId')
  @ZodResponse({ type: GetRoleDetailOutputDTO })
  getDetail(@Param() params: RoleIdParamDTO) {
    return this.roleService.getDetail(params.roleId);
  }

  @Put(':roleId')
  @ZodResponse({ type: MessageResDTO })
  update(
    @Param() params: RoleIdParamDTO,
    @Body() body: UpdateRoleInputDTO,
    @ActiveUser('userId') userId: string,
  ) {
    return this.roleService.update({
      id: params.roleId,
      data: body,
      updatedById: userId,
    });
  }

  @Delete()
  @ZodResponse({ type: MessageResDTO })
  deleteMany(@Body() body: DeleteManyRoleInputDTO, @ActiveUser('userId') userId: string) {
    return this.roleService.deleteMany({
      data: body,
      deletedById: userId,
    });
  }

  @Get(':roleId/permissions')
  @ZodResponse({ type: GetRolePermissionsOutputDTO })
  getPermissions(@Param() params: RoleIdParamDTO) {
    return this.roleService.getPermissions(params.roleId);
  }

  @Put(':roleId/permissions')
  @ZodResponse({ type: MessageResDTO })
  updatePermissions(@Param() params: RoleIdParamDTO, @Body() body: UpdateRolePermissionsInputDTO) {
    return this.roleService.updatePermissions({
      id: params.roleId,
      data: body,
    });
  }
}
