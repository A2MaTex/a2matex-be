import { z } from 'zod';
import { zDate } from '../shared/utils/zod.ts';
import { Base } from './base.model.js';

export const Device = Base.extend({
  userId: z.uuid(),
  userAgent: z.string(),
  ip: z.string(),
  lastActive: zDate(),
  isActive: z.boolean(),
});

export type DeviceType = z.infer<typeof Device>;
