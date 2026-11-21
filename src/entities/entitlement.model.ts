import { z } from 'zod';
import {
  EntitlementGrantSource,
  EntitlementStatus,
} from '../shared/constants/entitlement.constant.ts';
import { zDate, zJsonObject } from '../shared/utils/zod.ts';

export const EntitlementStatusSchema = z.enum([
  EntitlementStatus.ACTIVE,
  EntitlementStatus.REVOKED,
]);

export const EntitlementGrantSourceSchema = z.enum([
  EntitlementGrantSource.ORDER,
  EntitlementGrantSource.ADMIN_GRANT,
]);

export const Entitlement = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
  productId: z.uuid(),
  status: EntitlementStatusSchema,
  grantSource: EntitlementGrantSourceSchema,
  grantedById: z.uuid().nullable(),
  startsAt: zDate(),
  expiresAt: zDate().nullable(),
  latestProductOfferId: z.uuid().nullable(),
  latestOrderItemId: z.uuid().nullable(),
  oneTimePurchasedAt: zDate().nullable(),
  grantSnapshot: zJsonObject(),
  revokedAt: zDate().nullable(),
  revokedById: z.uuid().nullable(),
  revokedReason: z.string().nullable(),
  auditHistory: z.array(z.json()),
  createdAt: zDate(),
  updatedAt: zDate().nullable(),
});

export type EntitlementEntityType = z.infer<typeof Entitlement>;
