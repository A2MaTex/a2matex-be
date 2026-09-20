import z from 'zod';

export const Base = z.object({
  id: z.uuid(),
  createdAt: z.date(),
  updatedAt: z.date().nullable(),
  deletedAt: z.date().nullable(),
});

export const BaseWithUserFields = Base.extend({
  createdById: z.uuid(),
  updatedById: z.uuid().nullable(),
  deletedById: z.uuid().nullable(),
});

export type BaseType = z.infer<typeof Base>;
export type BaseWithUserFieldsType = z.infer<typeof BaseWithUserFields>;
