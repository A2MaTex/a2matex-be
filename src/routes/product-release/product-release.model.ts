import { z } from 'zod';
import {
  PRODUCT_RELEASE_DISABLE_REASON_MAX_LENGTH,
  ProductReleaseLifecycleAction,
  ProductReleaseStatus,
} from '../../shared/constants/product-release.constant.ts';
import { PaginationQuerySchema } from '../../shared/models/request.model.ts';
import { zDate, zJsonObject } from '../../shared/utils/zod.ts';

export const ProductReleaseStatusSchema = z.enum([
  ProductReleaseStatus.BUILDING,
  ProductReleaseStatus.PUBLISHED,
  ProductReleaseStatus.BUILD_FAILED,
  ProductReleaseStatus.DISABLED,
]);

export const ProductReleaseProductParam = z
  .object({
    productId: z.uuid(),
  })
  .strict();

export const ProductReleaseParam = z
  .object({
    productId: z.uuid(),
    releaseId: z.uuid(),
  })
  .strict();

export const GetProductReleaseListInput = PaginationQuerySchema.strict();

export const SelectCurrentProductReleaseInput = z
  .object({
    releaseId: z.uuid(),
  })
  .strict();

export const ProductReleaseLifecycleInput = z
  .object({
    action: z.enum([ProductReleaseLifecycleAction.DISABLE]),
    reason: z.string().trim().min(1).max(PRODUCT_RELEASE_DISABLE_REASON_MAX_LENGTH),
    replacementReleaseId: z.uuid().optional(),
  })
  .strict();

export const ProductReleaseSummaryOutput = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  submissionId: z.uuid(),
  version: z.string(),
  status: ProductReleaseStatusSchema,
  buildFailureCode: z.string(),
  changelog: z.string(),
  minimumLauncherVersion: z.string(),
  minimumRuntimeVersion: z.string(),
  publishedAt: zDate().nullable(),
  createdAt: zDate(),
  isCurrent: z.boolean(),
});

export const ProductReleaseDetailOutput = ProductReleaseSummaryOutput.extend({
  workflowRevisionId: z.uuid(),
  packageSizeBytes: z.string().nullable(),
  packageHash: z.string().nullable(),
  requiredCapabilities: z.array(z.string()),
  inputSchema: zJsonObject(),
  disabledAt: zDate().nullable(),
  disabledReason: z.string().nullable(),
  // Present only for an unrestricted Admin; omitted for Publishers.
  buildFailureCode: z.string().nullable().optional(),
});

export const GetProductReleaseListOutput = z.object({
  items: z.array(ProductReleaseSummaryOutput),
  totalItems: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

export type GetProductReleaseListInputType = z.infer<typeof GetProductReleaseListInput>;
export type SelectCurrentProductReleaseInputType = z.infer<typeof SelectCurrentProductReleaseInput>;
export type ProductReleaseLifecycleInputType = z.infer<typeof ProductReleaseLifecycleInput>;
export type ProductReleaseSummaryOutputType = z.infer<typeof ProductReleaseSummaryOutput>;
export type ProductReleaseDetailOutputType = z.infer<typeof ProductReleaseDetailOutput>;
export type GetProductReleaseListOutputType = z.infer<typeof GetProductReleaseListOutput>;
