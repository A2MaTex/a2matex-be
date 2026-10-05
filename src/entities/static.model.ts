import { z } from 'zod';
import { STATIC_CONTENT_TYPE_MAX_LENGTH } from '../shared/constants/storage.constant.ts';
import { Base } from './base.model.ts';

export const Static = Base.extend({
  objectKey: z.string().min(1),
  originalFileName: z.string().min(1),
  contentType: z.string().min(1).max(STATIC_CONTENT_TYPE_MAX_LENGTH),
  size: z.bigint().nonnegative(),
});

export type StaticEntityType = z.infer<typeof Static>;
