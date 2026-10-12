import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { REQUEST_ROLE_PERMISSIONS } from '../constants/auth.constant.ts';
import type { PermissionScopeType } from '../constants/role.constant.ts';
import type { RolePermissionPayload } from '../types/role-permission.type.ts';

export type ActivePermissionScope = PermissionScopeType | null;

export const ActivePermissionScopes = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ActivePermissionScope[] => {
    const request = context.switchToHttp().getRequest();
    const rolePermissions: RolePermissionPayload | undefined = request[REQUEST_ROLE_PERMISSIONS];

    return [...new Set(rolePermissions?.activeRoutePermissions?.map(({ scope }) => scope) ?? [])];
  },
);
