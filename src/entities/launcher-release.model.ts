import { z } from 'zod';
import { zDate } from '../shared/utils/zod.ts';
import { Base } from './base.model.ts';

export const LauncherRelease = Base.extend({
  version: z.string().trim().min(1).max(100),
  staticId: z.uuid(),
  releaseNotes: z.string().trim().min(1).nullable(),
  isActive: z.boolean(),
  publishedAt: zDate().nullable(),
});

export type LauncherReleaseEntityType = z.infer<typeof LauncherRelease>;
