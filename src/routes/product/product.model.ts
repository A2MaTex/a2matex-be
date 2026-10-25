import { z } from 'zod';
import { Product } from '../../entities/product.model.ts';
import {
  PRODUCT_MEDIA_ALT_TEXT_MAX_LENGTH,
  PRODUCT_NAME_MAX_LENGTH,
  PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_SLUG_MAX_LENGTH,
  PRODUCT_SLUG_PATTERN,
  ProductMediaType,
} from '../../shared/constants/product.constant.ts';
import { ProjectStatus } from '../../shared/constants/project.constant.ts';

const MEDIA_INVALID = 'Error.ProductMediaInvalid';

const ProductNameInput = z.string().trim().min(1).max(PRODUCT_NAME_MAX_LENGTH);

const ProductSlugInput = z
  .string()
  .trim()
  .min(1)
  .max(PRODUCT_SLUG_MAX_LENGTH)
  .transform((slug) => slug.toLowerCase())
  .refine((slug) => PRODUCT_SLUG_PATTERN.test(slug), {
    message: 'Error.ProductSlugInvalid',
  });

const ProductShortDescriptionInput = z
  .string()
  .trim()
  .min(1)
  .max(PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH);
const ProductDescriptionInput = z.string().trim().min(1);
const ProductUsageInstructionsInput = z.string().trim().min(1);

export const ProductMediaTypeSchema = z.enum([
  ProductMediaType.ICON,
  ProductMediaType.COVER,
  ProductMediaType.GALLERY,
]);

export const ProductMediaInput = z
  .object({
    staticId: z.uuid(),
    type: ProductMediaTypeSchema,
    sortOrder: z.number().int().nonnegative(),
    altText: z
      .string()
      .trim()
      .max(PRODUCT_MEDIA_ALT_TEXT_MAX_LENGTH)
      .nullable()
      .optional()
      .transform((altText) => altText || null),
  })
  .strict();

// Set-level problems belong here so they answer 422 with a field path. Left to the
// partial unique indexes they would raise P2002 and answer 409.
const ProductMediaSetInput = z.array(ProductMediaInput).superRefine((media, ctx) => {
  const seenStaticIds = new Set<string>();
  media.forEach((item, index) => {
    if (seenStaticIds.has(item.staticId)) {
      ctx.addIssue({
        code: 'custom',
        message: MEDIA_INVALID,
        path: [index, 'staticId'],
      });
    }
    seenStaticIds.add(item.staticId);
  });

  for (const singleType of [ProductMediaType.ICON, ProductMediaType.COVER] as const) {
    if (media.filter((item) => item.type === singleType).length > 1) {
      ctx.addIssue({
        code: 'custom',
        message: MEDIA_INVALID,
        path: ['type'],
      });
    }
  }
});

export const ProductIdParam = z
  .object({
    productId: z.uuid(),
  })
  .strict();

export const CreateProductInput = z
  .object({
    projectId: z.uuid(),
    name: ProductNameInput.nullable().optional(),
    slug: ProductSlugInput.nullable().optional(),
    shortDescription: ProductShortDescriptionInput.nullable().optional(),
    description: ProductDescriptionInput.nullable().optional(),
    usageInstructions: ProductUsageInstructionsInput.nullable().optional(),
    media: ProductMediaSetInput.optional().default([]),
  })
  .strict();

export const UpdateProductInput = z
  .object({
    name: ProductNameInput.nullable().optional(),
    slug: ProductSlugInput.nullable().optional(),
    shortDescription: ProductShortDescriptionInput.nullable().optional(),
    description: ProductDescriptionInput.nullable().optional(),
    usageInstructions: ProductUsageInstructionsInput.nullable().optional(),
    media: ProductMediaSetInput.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.slug !== undefined ||
      value.shortDescription !== undefined ||
      value.description !== undefined ||
      value.usageInstructions !== undefined ||
      value.media !== undefined,
    {
      message: 'At least one field is required',
    },
  );

export const ProductProjectSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum([ProjectStatus.ACTIVE, ProjectStatus.ARCHIVED]),
});

export const ProductMediaOutput = z.object({
  id: z.uuid(),
  staticId: z.uuid(),
  type: ProductMediaTypeSchema,
  sortOrder: z.number().int(),
  altText: z.string().nullable(),
});

export const ProductManagementOutput = Product.pick({
  id: true,
  publisherAccountId: true,
  status: true,
  name: true,
  slug: true,
  shortDescription: true,
  description: true,
  usageInstructions: true,
  currentReleaseId: true,
  statusReason: true,
  suspendedAt: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  project: ProductProjectSummary,
  media: z.array(ProductMediaOutput),
});

export type ProductMediaInputType = z.infer<typeof ProductMediaInput>;
export type CreateProductInputType = z.infer<typeof CreateProductInput>;
export type UpdateProductInputType = z.infer<typeof UpdateProductInput>;
export type ProductManagementOutputType = z.infer<typeof ProductManagementOutput>;
