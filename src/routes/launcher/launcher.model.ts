import { z } from 'zod';
import { zDate } from '../../shared/utils/zod.ts';

export const LauncherProductEntitlement = z.object({
  id: z.uuid(),
  startsAt: zDate(),
  expiresAt: zDate().nullable(),
});

export const LauncherProductRelease = z.object({
  id: z.uuid(),
  version: z.string(),
  packageHash: z.string(),
  publishedAt: zDate(),
});

export const LauncherProductItem = z.object({
  productId: z.uuid(),
  name: z.string(),
  shortDescription: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  publisherDisplayName: z.string(),
  entitlement: LauncherProductEntitlement,
  currentRelease: LauncherProductRelease,
});

export const LauncherProductListOutput = z.object({
  items: z.array(LauncherProductItem),
});

export type LauncherProductEntitlementType = z.infer<typeof LauncherProductEntitlement>;
export type LauncherProductReleaseType = z.infer<typeof LauncherProductRelease>;
export type LauncherProductItemType = z.infer<typeof LauncherProductItem>;
export type LauncherProductListOutputType = z.infer<typeof LauncherProductListOutput>;
