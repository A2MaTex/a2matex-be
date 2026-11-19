import { z } from 'zod';
import {
  PUBLIC_PRODUCT_LIST_MAX_LIMIT,
  PUBLIC_PRODUCT_SEARCH_MAX_LENGTH,
} from '../../shared/constants/product.constant.ts';
import { DEFAULT_LIMIT } from '../../shared/constants/system.constant.ts';
import { PaginationQuerySchema } from '../../shared/models/request.model.ts';
import { zBigIntAsString, zDate } from '../../shared/utils/zod.ts';
import { ProductOfferOutput } from '../product-offer/product-offer.model.ts';
import { ProductMediaTypeSchema } from './product.model.ts';

export const PublicProductPublisherOutput = z.object({
  username: z.string(),
  displayName: z.string(),
});

// Identity and version come from the ProductRelease row; the minimum client versions
// live in the approved Submission release request.
export const PublicProductReleaseOutput = z.object({
  id: z.uuid(),
  version: z.string(),
  publishedAt: zDate(),
  minimumLauncherVersion: z.string(),
  minimumRuntimeVersion: z.string(),
});

// Ordered image metadata frozen in the approved Submission snapshot. The Static ID is what
// the client feeds to the public image route; no object key or private URL is exposed.
export const PublicProductMediaOutput = z.object({
  id: z.uuid(),
  staticId: z.uuid(),
  type: ProductMediaTypeSchema,
  sortOrder: z.number().int(),
  altText: z.string().nullable(),
});

export const PublicProductMinimumSubscriptionOffer = z.object({
  priceAmount: zBigIntAsString(),
  durationDays: z.number().int(),
});

// Presentation fields are projected from the approved Submission snapshot, never from
// the mutable Product row, and never carry media or Static identifiers.
export const PublicProductSummaryOutput = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  shortDescription: z.string(),
  publisher: PublicProductPublisherOutput,
  currentRelease: PublicProductReleaseOutput,
  minimumSubscriptionOffer: PublicProductMinimumSubscriptionOffer,
  media: z.array(PublicProductMediaOutput),
});

// Offers come from the live collection: commercial terms are managed outside review.
export const PublicProductDetailOutput = PublicProductSummaryOutput.extend({
  description: z.string(),
  usageInstructions: z.string().nullable(),
  offers: z.array(ProductOfferOutput),
});

// Same page size as every other list; the cap is the one addition a public route needs.
export const GetPublicProductListInput = PaginationQuerySchema.extend({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(PUBLIC_PRODUCT_LIST_MAX_LIMIT)
    .default(DEFAULT_LIMIT),
  q: z.string().trim().min(1).max(PUBLIC_PRODUCT_SEARCH_MAX_LENGTH).optional(),
}).strict();

export const GetPublicProductListOutput = z.object({
  items: z.array(PublicProductSummaryOutput),
  totalItems: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

export type GetPublicProductListInputType = z.infer<typeof GetPublicProductListInput>;
// z.input: prices leave Prisma as bigint and the response interceptor serializes them.
export type PublicProductSummaryOutputType = z.input<typeof PublicProductSummaryOutput>;
export type PublicProductDetailOutputType = z.input<typeof PublicProductDetailOutput>;
export type GetPublicProductListOutputType = z.input<typeof GetPublicProductListOutput>;
