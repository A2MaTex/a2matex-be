import { z } from 'zod';
import { Permission } from '../../entities/permission.model.ts';
import { PaginationQuerySchema } from '../../shared/models/request.model.ts';

export const PermissionIdParam = z
  .object({
    permissionId: z.uuid(),
  })
  .strict();

export const PermissionOutput = Permission;

export const CreatePermissionInput = Permission.pick({
  name: true,
  description: true,
  module: true,
  path: true,
  method: true,
}).strict();

export const CreatePermissionOutput = Permission.pick({
  id: true,
});

export const GetPermissionListInput = PaginationQuerySchema.strict();

export const GetPermissionListOutput = z.object({
  data: z.array(PermissionOutput),
  totalItems: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
});

export const GetPermissionDetailOutput = PermissionOutput;

export const UpdatePermissionInput = CreatePermissionInput.partial().strict();

export const DeleteManyPermissionInput = z
  .object({
    ids: z.array(z.uuid()).min(1),
  })
  .strict();

export type PermissionOutputType = z.infer<typeof PermissionOutput>;
export type CreatePermissionInputType = z.infer<typeof CreatePermissionInput>;
export type CreatePermissionOutputType = z.infer<typeof CreatePermissionOutput>;
export type GetPermissionListInputType = z.infer<typeof GetPermissionListInput>;
export type GetPermissionListOutputType = z.infer<typeof GetPermissionListOutput>;
export type GetPermissionDetailOutputType = z.infer<typeof GetPermissionDetailOutput>;
export type UpdatePermissionInputType = z.infer<typeof UpdatePermissionInput>;
export type DeleteManyPermissionInputType = z.infer<typeof DeleteManyPermissionInput>;
