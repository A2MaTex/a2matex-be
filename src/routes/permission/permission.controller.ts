import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { MessageResDTO } from '../../shared/dtos/response.dto.ts';
import {
  CreatePermissionInputDTO,
  CreatePermissionOutputDTO,
  DeleteManyPermissionInputDTO,
  GetPermissionDetailOutputDTO,
  GetPermissionListInputDTO,
  GetPermissionListOutputDTO,
  PermissionIdParamDTO,
  UpdatePermissionInputDTO,
} from './permission.dto.ts';
import { PermissionService } from './permission.service.ts';

@Controller('permissions')
export class PermissionController {
  constructor(@Inject(PermissionService) private readonly permissionService: PermissionService) {}

  @Post()
  @ZodResponse({ type: CreatePermissionOutputDTO })
  create(@Body() body: CreatePermissionInputDTO, @ActiveUser('userId') userId: string) {
    return this.permissionService.create({
      data: body,
      createdById: userId,
    });
  }

  @Get()
  @ZodResponse({ type: GetPermissionListOutputDTO })
  getList(@Query() query: GetPermissionListInputDTO) {
    return this.permissionService.getList(query);
  }

  @Get(':permissionId')
  @ZodResponse({ type: GetPermissionDetailOutputDTO })
  getDetail(@Param() params: PermissionIdParamDTO) {
    return this.permissionService.getDetail(params.permissionId);
  }

  @Put(':permissionId')
  @ZodResponse({ type: MessageResDTO })
  update(
    @Param() params: PermissionIdParamDTO,
    @Body() body: UpdatePermissionInputDTO,
    @ActiveUser('userId') userId: string,
  ) {
    return this.permissionService.update({
      id: params.permissionId,
      data: body,
      updatedById: userId,
    });
  }

  @Delete()
  @ZodResponse({ type: MessageResDTO })
  deleteMany(@Body() body: DeleteManyPermissionInputDTO, @ActiveUser('userId') userId: string) {
    return this.permissionService.deleteMany({
      data: body,
      deletedById: userId,
    });
  }
}
