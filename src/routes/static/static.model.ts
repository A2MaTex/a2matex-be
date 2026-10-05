import { z } from 'zod';
import { Static } from '../../entities/static.model.ts';
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

export type UploadStaticFileInputType = z.infer<typeof UploadStaticFileInput>;
