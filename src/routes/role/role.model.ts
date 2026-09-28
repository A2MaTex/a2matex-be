import { z } from 'zod';
import { Role } from '../../entities/role.schema.ts';
import { Permission } from '../../entities/permission.model.ts';
import { RoleStatus } from '../../shared/constants/auth.constant.ts';
import { PaginationQuerySchema } from '../../shared/models/request.model.ts';

export const RoleIdParam = z
  .object({
    roleId: z.uuid(),
  })
  .strict();

export const RoleOutput = Role;

export const RoleDetailOutput = Role.extend({
  permissions: z.array(Permission),
});

export const CreateRoleInput = Role.pick({
  name: true,
  description: true,
})
  .extend({
    status: z.enum([RoleStatus.ACTIVE, RoleStatus.INACTIVE]).default(RoleStatus.ACTIVE),
  })
  .strict();

export const CreateRoleOutput = Role.pick({
  id: true,
});

export const GetRoleListInput = PaginationQuerySchema.strict();

export const GetRoleListOutput = z.object({
  data: z.array(RoleOutput),
  totalItems: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
});

export const GetRoleDetailOutput = RoleDetailOutput;

export const GetRolePermissionsOutput = z.object({
  data: z.array(z.uuid()),
});

export const DeleteManyRoleInput = z
  .object({
    ids: z.array(z.uuid()).min(1),
  })
  .strict();

export const UpdateRoleInput = CreateRoleInput.partial().strict();

export const UpdateRolePermissionsInput = z
  .object({
    permissionIds: z.array(z.uuid()),
  })
  .strict();

export type RoleOutputType = z.infer<typeof RoleOutput>;
export type RoleDetailOutputType = z.infer<typeof RoleDetailOutput>;
export type CreateRoleInputType = z.infer<typeof CreateRoleInput>;
export type CreateRoleOutputType = z.infer<typeof CreateRoleOutput>;
export type GetRoleListInputType = z.infer<typeof GetRoleListInput>;
export type GetRoleListOutputType = z.infer<typeof GetRoleListOutput>;
export type GetRoleDetailOutputType = z.infer<typeof GetRoleDetailOutput>;
export type UpdateRoleInputType = z.infer<typeof UpdateRoleInput>;
export type DeleteManyRoleInputType = z.infer<typeof DeleteManyRoleInput>;
export type GetRolePermissionsOutputType = z.infer<typeof GetRolePermissionsOutput>;
export type UpdateRolePermissionsInputType = z.infer<typeof UpdateRolePermissionsInput>;
