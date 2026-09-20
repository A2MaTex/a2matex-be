import { UserStatus } from '../shared/constants/auth.constant.ts';
import { z } from 'zod';
import { Base } from './base.model.ts';

export const User = Base.extend({
  username: z.string().min(1).max(100),
  email: z.email(),
  password: z.string().min(6),
  status: z.enum([UserStatus.ACTIVE, UserStatus.INACTIVE, UserStatus.BANNED]),
});

export type UserType = z.infer<typeof User>;
