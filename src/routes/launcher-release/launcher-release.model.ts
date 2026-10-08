import { z } from 'zod';
import { LauncherRelease } from '../../entities/launcher-release.model.ts';
import { Static } from '../../entities/static.model.ts';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '../../shared/constants/system.constant.ts';

export const LauncherReleaseIdParam = z
  .object({
    launcherReleaseId: z.uuid(),
  })
  .strict();

const StaticMetadataOutput = Static.pick({
  id: true,
  originalFileName: true,
  contentType: true,
}).extend({
  size: z.number().int().nonnegative(),
});

export const CurrentLauncherReleaseOutput = LauncherRelease.pick({
  id: true,
  version: true,
  staticId: true,
  releaseNotes: true,
  publishedAt: true,
});

export const CreateLauncherReleaseInput = LauncherRelease.pick({
  version: true,
  staticId: true,
  releaseNotes: true,
})
  .partial({ releaseNotes: true })
  .strict();

export const CreateLauncherReleaseOutput = LauncherRelease.pick({ id: true });

export const GetLauncherReleaseListInput = z
  .object({
    page: z.coerce.number().int().positive().default(DEFAULT_PAGE),
    pageSize: z.coerce.number().int().positive().default(DEFAULT_LIMIT),
  })
  .strict();

export const LauncherReleaseListItemOutput = LauncherRelease.pick({
  id: true,
  version: true,
  staticId: true,
  isActive: true,
  publishedAt: true,
  createdAt: true,
}).extend({
  originalFileName: z.string().min(1),
  size: z.number().int().nonnegative(),
});

export const GetLauncherReleaseListOutput = z.object({
  items: z.array(LauncherReleaseListItemOutput),
  totalItems: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

export const GetLauncherReleaseDetailOutput = LauncherRelease.pick({
  id: true,
  version: true,
  staticId: true,
  releaseNotes: true,
  isActive: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  static: StaticMetadataOutput,
});

export const UpdateLauncherReleaseInput = LauncherRelease.pick({
  version: true,
  staticId: true,
  releaseNotes: true,
})
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export type CreateLauncherReleaseInputType = z.infer<typeof CreateLauncherReleaseInput>;
export type GetLauncherReleaseListInputType = z.infer<typeof GetLauncherReleaseListInput>;
export type GetLauncherReleaseListOutputType = z.infer<typeof GetLauncherReleaseListOutput>;
export type GetLauncherReleaseDetailOutputType = z.infer<typeof GetLauncherReleaseDetailOutput>;
export type UpdateLauncherReleaseInputType = z.infer<typeof UpdateLauncherReleaseInput>;
