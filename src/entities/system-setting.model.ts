import { z } from 'zod';
import { zDate } from '../shared/utils/zod.ts';

// No `deletedAt`: a declared key with no row is what the startup check treats as fatal,
// so the Base shape does not fit.
export const SystemSetting = z.object({
  id: z.uuid(),
  key: z.string().trim().min(1).max(100),
  value: z.record(z.string(), z.json()),
  createdAt: zDate(),
  updatedAt: zDate().nullable(),
  updatedById: z.uuid().nullable(),
  auditHistory: z.array(z.json()),
});

export type SystemSettingEntityType = z.infer<typeof SystemSetting>;
