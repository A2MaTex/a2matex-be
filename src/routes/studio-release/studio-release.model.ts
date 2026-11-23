import { z } from 'zod';
import { Static } from '../../entities/static.model.ts';
import { StudioRelease } from '../../entities/studio-release.model.ts';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '../../shared/constants/system.constant.ts';
import { STRICT_SEMANTIC_VERSION_PATTERN } from '../node-catalog/node-catalog.constant.ts';

export const STUDIO_RELEASE_PAGE_SIZE_MAX = 100;

// Pattern không nhận hậu tố tiền phát hành hay metadata: 1.0.0-beta.1 và 1.0.0+build đều bị loại.
const SemanticVersion = z
  .string()
  .trim()
  .max(100)
  .regex(STRICT_SEMANTIC_VERSION_PATTERN, { message: 'Error.StudioReleaseVersionInvalid' });

export const StudioReleaseIdParam = z
  .object({
    studioReleaseId: z.uuid(),
  })
  .strict();

const StaticMetadataOutput = Static.pick({
  id: true,
  originalFileName: true,
  contentType: true,
}).extend({
  size: z.number().int().nonnegative(),
});

export const CurrentStudioReleaseOutput = StudioRelease.pick({
  id: true,
  version: true,
  staticId: true,
  releaseNotes: true,
  publishedAt: true,
});

export const CreateStudioReleaseInput = StudioRelease.pick({
  staticId: true,
  releaseNotes: true,
})
  .extend({ version: SemanticVersion })
  .partial({ releaseNotes: true })
  .strict();

export const CreateStudioReleaseOutput = StudioRelease.pick({ id: true });

export const GetStudioReleaseListInput = z
  .object({
    page: z.coerce.number().int().positive().default(DEFAULT_PAGE),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .max(STUDIO_RELEASE_PAGE_SIZE_MAX)
      .default(DEFAULT_LIMIT),
  })
  .strict();

export const StudioReleaseListItemOutput = StudioRelease.pick({
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

export const GetStudioReleaseListOutput = z.object({
  items: z.array(StudioReleaseListItemOutput),
  totalItems: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

export const GetStudioReleaseDetailOutput = StudioRelease.pick({
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

export const UpdateStudioReleaseInput = StudioRelease.pick({
  staticId: true,
  releaseNotes: true,
})
  .extend({ version: SemanticVersion })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export type CreateStudioReleaseInputType = z.infer<typeof CreateStudioReleaseInput>;
export type GetStudioReleaseListInputType = z.infer<typeof GetStudioReleaseListInput>;
export type GetStudioReleaseListOutputType = z.infer<typeof GetStudioReleaseListOutput>;
export type GetStudioReleaseDetailOutputType = z.infer<typeof GetStudioReleaseDetailOutput>;
export type UpdateStudioReleaseInputType = z.infer<typeof UpdateStudioReleaseInput>;
