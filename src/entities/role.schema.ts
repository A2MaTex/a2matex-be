import { RoleStatus } from '../shared/constants/auth.constant.ts';
import z from 'zod';
import { BaseWithUserFields } from './base.model.ts';

export const Role = BaseWithUserFields.extend({
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum([RoleStatus.ACTIVE, RoleStatus.INACTIVE]),
});

export type RoleType = z.infer<typeof Role>;
