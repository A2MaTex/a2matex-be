import { z } from 'zod';
import { Static } from '../../entities/static.model.ts';
import { STATIC_IMAGE_VARIANTS } from '../../shared/constants/storage.constant.ts';
import { isValidStaticPrefix } from '../../shared/utils/utils.ts';

export const StaticIdParam = z
  .object({
    staticId: z.uuid(),
  })
  .strict();

export const UploadStaticFileInput = z
  .object({
    prefix: z
      .string()
      .refine(isValidStaticPrefix, {
        message: 'Prefix contains an invalid path segment',
      })
      .optional(),
  })
  .strict();

export const UploadStaticFileOutput = Static.pick({ id: true });

export const GetStaticImageQuery = z
  .object({
    variant: z
      .enum(STATIC_IMAGE_VARIANTS, {
        error: 'Error.InvalidImageVariant',
      })
      .default('large'),
  })
  .strict();

export type UploadStaticFileInputType = z.infer<typeof UploadStaticFileInput>;
export type GetStaticImageQueryType = z.infer<typeof GetStaticImageQuery>;
