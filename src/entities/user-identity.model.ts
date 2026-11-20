import { z } from 'zod';
import { OAuthProvider } from '../shared/constants/auth.constant.ts';
import { zDate } from '../shared/utils/zod.ts';

export const UserIdentity = z.object({
  id: z.uuid(),
  provider: z.enum([OAuthProvider.GOOGLE, OAuthProvider.GITHUB]),
  providerUserId: z.string().min(1).max(255),
  userId: z.uuid(),
  email: z.email().nullable(),
  createdAt: zDate(),
  updatedAt: zDate().nullable(),
});

export type UserIdentityType = z.infer<typeof UserIdentity>;
