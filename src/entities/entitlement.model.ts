import { z } from 'zod';
import {
  EntitlementGrantSource,
  EntitlementStatus,
} from '../shared/constants/entitlement.constant.ts';
import { zDate } from '../shared/utils/zod.ts';

export const EntitlementStatusSchema = z.enum([
  EntitlementStatus.ACTIVE,
  EntitlementStatus.EXPIRED,
  EntitlementStatus.REVOKED,
]);

export const EntitlementGrantSourceSchema = z.enum([
  EntitlementGrantSource.FREE_ACQUISITION,
  EntitlementGrantSource.ORDER,
  EntitlementGrantSource.ADMIN_GRANT,
]);

export const EntitlementGrantSnapshot = z.record(z.string(), z.json());

export const Entitlement = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
  productId: z.uuid(),
  productOfferId: z.uuid().nullable(),
  orderItemId: z.uuid().nullable(),
  status: EntitlementStatusSchema,
  grantSource: EntitlementGrantSourceSchema,
  startsAt: zDate(),
  expiresAt: zDate().nullable(),
  maxConcurrentDevices: z.number().int(),
  grantSnapshot: EntitlementGrantSnapshot,
  grantedById: z.uuid().nullable(),
  revokedAt: zDate().nullable(),
  revokedById: z.uuid().nullable(),
  revokedReason: z.string().nullable(),
  createdAt: zDate(),
  updatedAt: zDate().nullable(),
});

export type EntitlementEntityType = z.infer<typeof Entitlement>;
