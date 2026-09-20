import { z } from 'zod';
import { Base } from './base.model.js';

export const Device = Base.extend({
  userId: z.uuid(),
  userAgent: z.string(),
  ip: z.string(),
  lastActive: z.date(),
  isActive: z.boolean(),
});

export type DeviceType = z.infer<typeof Device>;
