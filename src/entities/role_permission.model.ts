import z from 'zod';
import { BaseWithUserFields } from './base.model.ts';

export const RolePermission = BaseWithUserFields.extend({
  roleId: z.number(),
  permissionId: z.number(),
});

export type RolePermissionType = z.infer<typeof RolePermission>;
