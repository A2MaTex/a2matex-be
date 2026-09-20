import z from 'zod';

import { Base } from './base.model.ts';

export const RefreshToken = Base.extend({
  token: z.string(),
  userId: z.uuid(),
  deviceId: z.uuid(),
  expiresAt: z.date(),
});

export type RefreshTokenType = z.infer<typeof RefreshToken>;
