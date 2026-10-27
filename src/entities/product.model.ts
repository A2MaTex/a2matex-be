import { z } from 'zod';
import {
  PRODUCT_NAME_MAX_LENGTH,
  PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_SLUG_MAX_LENGTH,
  ProductStatus,
} from '../shared/constants/product.constant.ts';
import { zDate } from '../shared/utils/zod.ts';
import { BaseWithUserFields } from './base.model.ts';

export const Product = BaseWithUserFields.extend({
  publisherAccountId: z.uuid(),
  projectId: z.uuid(),
  status: z.enum([
    ProductStatus.DRAFT,
    ProductStatus.ACTIVE,
    ProductStatus.SUSPENDED,
    ProductStatus.ARCHIVED,
  ]),
  currentReleaseId: z.uuid().nullable(),
  name: z.string().max(PRODUCT_NAME_MAX_LENGTH).nullable(),
  slug: z.string().max(PRODUCT_SLUG_MAX_LENGTH).nullable(),
  shortDescription: z.string().max(PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH).nullable(),
  description: z.string().nullable(),
  usageInstructions: z.string().nullable(),
  statusReason: z.string().nullable(),
  suspendedAt: zDate().nullable(),
  suspendedById: z.uuid().nullable(),
});

export type ProductType = z.infer<typeof Product>;
