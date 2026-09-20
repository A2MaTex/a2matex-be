import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { REQUEST_ROLE_PERMISSIONS } from '../constants/auth.constant.js';
import { RolePermissionType } from '../../entities/role_permission.model.ts';

export const ActiveRolePermissions = createParamDecorator(
  (field: keyof RolePermissionType | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest();
    const rolePermissions: RolePermissionType | undefined = request[REQUEST_ROLE_PERMISSIONS];
    return field ? rolePermissions?.[field] : rolePermissions;
  },
);
