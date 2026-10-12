import { PermissionType } from '../../entities/permission.model.ts';

export type RolePermissionPayload = {
  roleIds: string[];
  permissions: Record<string, PermissionType[]>;
  activeRoutePermissions?: PermissionType[];
};
