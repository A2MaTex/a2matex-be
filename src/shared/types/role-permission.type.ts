import { PermissionType } from '../../entities/permission.model.ts';

export type RolePermissionPayload = {
  roleId: string;
  permissions: Record<string, PermissionType>;
};
