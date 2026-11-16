import z from 'zod';
import { BaseWithUserFields } from './base.model.ts';
import { zDate } from '../shared/utils/zod.ts';
import { ProductReleaseStatus } from '../shared/constants/product-release.constant.ts';

export const ProductRelease = BaseWithUserFields.extend({
  productId: z.uuid(),
  submissionId: z.uuid(),
  version: z.string(),
  description: z.string().nullable(),
  status: z.enum(Object.values(ProductReleaseStatus)),
  packageStaticId: z.uuid().nullable,
  packageHash: z.string().nullable(),
  wrappedKey: z.instanceof(Uint8Array).nullable(),
  nonce: z.instanceof(Uint8Array).nullable(),
  contentKeyNonce: z.instanceof(Uint8Array).nullable(),
  algorithm: z.string().nullable(),
  buildFailureCode: z.string().nullable(),
  publishedAt: zDate().nullable(),
  disabledAt: zDate().nullable(),
  disabledReason: z.string().nullable(),
});

export type ProductReleaseType = z.infer<typeof ProductRelease>;
