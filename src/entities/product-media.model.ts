import { z } from 'zod';
import {
  PRODUCT_MEDIA_ALT_TEXT_MAX_LENGTH,
  ProductMediaType,
} from '../shared/constants/product.constant.ts';
import { Base } from './base.model.ts';

export const ProductMedia = Base.extend({
  productId: z.uuid(),
  staticId: z.uuid(),
  type: z.enum([ProductMediaType.ICON, ProductMediaType.COVER, ProductMediaType.GALLERY]),
  sortOrder: z.number().int().nonnegative(),
  altText: z.string().max(PRODUCT_MEDIA_ALT_TEXT_MAX_LENGTH).nullable(),
});

export type ProductMediaEntityType = z.infer<typeof ProductMedia>;
