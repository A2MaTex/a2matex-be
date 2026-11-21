import { z } from 'zod';
import {
  EntitlementGrantSourceSchema,
  EntitlementStatusSchema,
} from '../../entities/entitlement.model.ts';
import { Product } from '../../entities/product.model.ts';
import {
  ENTITLEMENT_REASON_MAX_LENGTH,
  EntitlementAuditAction,
  EntitlementEffectiveStatus,
} from '../../shared/constants/entitlement.constant.ts';
import type { EntitlementUsageDenyReasonValue } from '../../shared/constants/entitlement.constant.ts';
import { zDate, zJsonObject } from '../../shared/utils/zod.ts';

export const ENTITLEMENT_PAGE_SIZE_MAX = 100;

const Reason = z.string().trim().min(1).max(ENTITLEMENT_REASON_MAX_LENGTH);

const Pagination = z.object({
  page: z.coerce.number().int().positive().safe().default(1),
  limit: z.coerce.number().int().positive().safe().max(ENTITLEMENT_PAGE_SIZE_MAX).default(10),
});

export const EntitlementEffectiveStatusSchema = z.enum([
  EntitlementEffectiveStatus.ACTIVE,
  EntitlementEffectiveStatus.EXPIRED,
  EntitlementEffectiveStatus.REVOKED,
]);

// ---- Audit history (stored on the row, append-only) ----

export const EntitlementStateSnapshotSchema = z.object({
  status: EntitlementStatusSchema,
  grantSource: EntitlementGrantSourceSchema,
  startsAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().optional(),
  revokedById: z.uuid().optional(),
  revokedReason: z.string().optional(),
});

export const EntitlementAuditEntrySchema = z.object({
  action: z.enum([EntitlementAuditAction.GRANT, EntitlementAuditAction.REVOKE]),
  reason: z.string(),
  actedAt: z.iso.datetime(),
  actedById: z.uuid(),
  before: EntitlementStateSnapshotSchema.nullable(),
  after: EntitlementStateSnapshotSchema,
});

export type EntitlementStateSnapshotType = z.infer<typeof EntitlementStateSnapshotSchema>;
export type EntitlementAuditEntryType = z.infer<typeof EntitlementAuditEntrySchema>;

// ---- Shared params / outputs ----

export const EntitlementIdParam = z
  .object({
    entitlementId: z.uuid(),
  })
  .strict();

export const AdminEntitlementOutput = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
  productId: z.uuid(),
  status: EntitlementEffectiveStatusSchema,
  storedStatus: EntitlementStatusSchema,
  grantSource: EntitlementGrantSourceSchema,
  grantedById: z.uuid().nullable(),
  startsAt: zDate(),
  expiresAt: zDate().nullable(),
  latestProductOfferId: z.uuid().nullable(),
  latestOrderItemId: z.uuid().nullable(),
  oneTimePurchasedAt: zDate().nullable(),
  revokedAt: zDate().nullable(),
  revokedById: z.uuid().nullable(),
  revokedReason: z.string().nullable(),
  // Written by this module against EntitlementAuditEntrySchema; returned, not re-parsed.
  auditHistory: z.array(zJsonObject(EntitlementAuditEntrySchema)),
  createdAt: zDate(),
  updatedAt: zDate().nullable(),
});

export type AdminEntitlementOutputType = z.infer<typeof AdminEntitlementOutput>;

// ---- Admin grant (US1) ----

export const GrantEntitlementInput = z
  .object({
    customerId: z.uuid(),
    productId: z.uuid(),
    // Required key: null means permanent, so a forgotten field never grants forever.
    // "In the future" is checked inside the transaction against the database clock.
    expiresAt: z.iso
      .datetime({ offset: true })
      .nullable()
      .transform((value) => (value === null ? null : new Date(value))),
    reason: Reason,
  })
  .strict();

export type GrantEntitlementInputType = z.infer<typeof GrantEntitlementInput>;

// ---- My Products (US2) ----

export const GetMyEntitlementsInput = Pagination.strict();

export type GetMyEntitlementsInputType = z.infer<typeof GetMyEntitlementsInput>;

export const MyEntitlementItemOutput = z.object({
  id: z.uuid(),
  status: EntitlementEffectiveStatusSchema,
  grantSource: EntitlementGrantSourceSchema,
  startsAt: zDate(),
  expiresAt: zDate().nullable(),
  product: Product.pick({ id: true, name: true, slug: true, status: true }),
  publisher: z.object({
    username: z.string(),
    displayName: z.string().nullable(),
  }),
});

export const GetMyEntitlementsOutput = z.object({
  items: z.array(MyEntitlementItemOutput),
  totalItems: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

export type MyEntitlementItemOutputType = z.infer<typeof MyEntitlementItemOutput>;
export type GetMyEntitlementsOutputType = z.infer<typeof GetMyEntitlementsOutput>;

// ---- Admin revoke (US3) ----

export const RevokeEntitlementInput = z
  .object({
    reason: Reason,
  })
  .strict();

export type RevokeEntitlementInputType = z.infer<typeof RevokeEntitlementInput>;

// ---- Admin lookup (US4) ----

export const GetAdminEntitlementsInput = Pagination.extend({
  customerId: z.uuid().optional(),
  productId: z.uuid().optional(),
}).strict();

export type GetAdminEntitlementsInputType = z.infer<typeof GetAdminEntitlementsInput>;

export const GetAdminEntitlementsOutput = z.object({
  items: z.array(AdminEntitlementOutput),
  totalItems: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

export type GetAdminEntitlementsOutputType = z.infer<typeof GetAdminEntitlementsOutput>;

// ---- Internal contracts (FR-010, FR-011) ----

export type UsageCheck =
  | { usable: true; entitlementId: string }
  | { usable: false; reason: EntitlementUsageDenyReasonValue };

// What Order shows after a purchase, and after a replay of one. Read-only.
export const EntitlementSummaryForOrder = z.object({
  id: z.uuid(),
  status: EntitlementEffectiveStatusSchema,
  startsAt: zDate(),
  expiresAt: zDate().nullable(),
});

export type EntitlementSummaryForOrderType = z.infer<typeof EntitlementSummaryForOrder>;

export type LockedPurchaseEntitlement = {
  id: string;
  status: z.infer<typeof EntitlementStatusSchema>;
  expiresAt: Date | null;
  oneTimePurchasedAt: Date | null;
};
