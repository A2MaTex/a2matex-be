import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { REQUEST_ROLE_PERMISSIONS } from '../constants/auth.constant.js';
import { RolePermissionPayload } from '../types/role-permission.type.ts';

export const ActiveRolePermissions = createParamDecorator(
  (field: keyof RolePermissionPayload | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest();
    const rolePermissions: RolePermissionPayload | undefined = request[REQUEST_ROLE_PERMISSIONS];
    return field ? rolePermissions?.[field] : rolePermissions;
  },
);
