import { string, z } from 'zod';
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

export const GetCompletedPartsInput = z
  .object({
    originalFileName: z.string(),
    lastModified: z.number().int().positive(),
    contentType: z.string(),
    size: z.number().int().positive(),
  })
  .strict();

export type UploadStaticFileInputType = z.infer<typeof UploadStaticFileInput>;
export type GetStaticImageQueryType = z.infer<typeof GetStaticImageQuery>;

const MULTIPART_MIN_PARTS_PER_REQUEST = 1;
const MULTIPART_MAX_PARTS_PER_REQUEST = 100;

export const UploadMultipartFileInput = z
  .object({
    originalFileName: z.string(),
    lastModified: z.number().int().positive(),
    contentType: z.string(),
    size: z.number().int().positive(),
    prefix: z.string().refine(isValidStaticPrefix, {
      message: 'Prefix contains an invalid path segment',
    }),
    requestedPartNumbers: z
      .array(z.number().int().positive())
      .min(MULTIPART_MIN_PARTS_PER_REQUEST)
      .max(MULTIPART_MAX_PARTS_PER_REQUEST),
  })
  .strict();

export const GetBatchUrlsInput = z
  .object({
    sessionId: z.uuid(),
    partNumbers: z
      .array(z.number().int().positive())
      .min(MULTIPART_MIN_PARTS_PER_REQUEST)
      .max(MULTIPART_MAX_PARTS_PER_REQUEST),
  })
  .strict();

export const GetBatchUrlsOutput = z
  .object({
    uploadUrls: z.array(
      z.object({
        partNumber: z.number().int().positive(),
        url: z.string(),
      }),
    ),
  })
  .strict();

export const CompleteMultipartUploadInput = z
  .object({
    sessionId: z.uuid(),
    parts: z.array(
      z.object({
        partNumber: z.number().int().positive(),
        etag: z.string(),
      }),
    ),
  })
  .strict();

export const CompleteMultipartUploadOutput = z
  .object({
    staticId: z.uuid(),
    originalFileName: z.string(),
    size: z.number(),
  })
  .strict();
