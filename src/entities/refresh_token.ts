import z from 'zod';
import { zDate } from '../shared/utils/zod.ts';

import { Base } from './base.model.ts';

export const RefreshToken = Base.extend({
  token: z.string(),
  userId: z.uuid(),
  deviceId: z.uuid(),
  expiresAt: zDate(),
});

export type RefreshTokenType = z.infer<typeof RefreshToken>;
