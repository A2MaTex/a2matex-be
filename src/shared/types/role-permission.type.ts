import type { PermissionScopeType } from '../constants/role.constant.ts';

export type PermissionGrant = {
  permissionId: string;
  scope: PermissionScopeType | null;
};

export type RolePermissionCacheValue = {
  roleName: string;
  routes: Record<string, PermissionGrant[]>;
};

export type RolePermissionPayload = {
  roleIds: string[];
  routeKey: string;
  grants: PermissionGrant[];
};
