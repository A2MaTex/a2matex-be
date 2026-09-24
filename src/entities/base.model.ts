import z from 'zod';
import { zDate } from '../shared/utils/zod.ts';

export const Base = z.object({
  id: z.uuid(),
  createdAt: zDate(),
  updatedAt: zDate().nullable(),
  deletedAt: zDate().nullable(),
});

export const BaseWithUserFields = Base.extend({
  createdById: z.uuid(),
  updatedById: z.uuid().nullable(),
  deletedById: z.uuid().nullable(),
});

export type BaseType = z.infer<typeof Base>;
export type BaseWithUserFieldsType = z.infer<typeof BaseWithUserFields>;
