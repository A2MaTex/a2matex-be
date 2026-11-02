import { UserStatus } from '../shared/constants/auth.constant.ts';
import { zDate } from '../shared/utils/zod.ts';
import { z } from 'zod';
import { Base } from './base.model.ts';

export const User = Base.extend({
  username: z.string().min(1).max(100),
  email: z.email(),
  password: z.string().min(6),
  status: z.enum([UserStatus.ACTIVE, UserStatus.INACTIVE, UserStatus.BANNED]),
  previousStatus: z
    .enum([UserStatus.ACTIVE, UserStatus.INACTIVE, UserStatus.BANNED])
    .nullable()
    .optional(),
  statusReason: z.string().nullable().optional(),
  statusChangedAt: zDate().nullable().optional(),
  statusChangedById: z.uuid().nullable().optional(),
});

export type UserType = z.infer<typeof User>;
