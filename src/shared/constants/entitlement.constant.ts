// Stored status. EXPIRED is never written: it is derived from "expiresAt" against the
// database clock at read time, so a stale ACTIVE row can never grant access.
export const EntitlementStatus = {
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
} as const;

export type EntitlementStatusValue = (typeof EntitlementStatus)[keyof typeof EntitlementStatus];

export const EntitlementGrantSource = {
  ORDER: 'ORDER',
  ADMIN_GRANT: 'ADMIN_GRANT',
} as const;

export type EntitlementGrantSourceValue =
  (typeof EntitlementGrantSource)[keyof typeof EntitlementGrantSource];

// What every API returns: REVOKED, then EXPIRED by time, otherwise ACTIVE.
export const EntitlementEffectiveStatus = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
} as const;

export type EntitlementEffectiveStatusValue =
  (typeof EntitlementEffectiveStatus)[keyof typeof EntitlementEffectiveStatus];

export const EntitlementAuditAction = {
  GRANT: 'GRANT',
  REVOKE: 'REVOKE',
} as const;

export type EntitlementAuditActionValue =
  (typeof EntitlementAuditAction)[keyof typeof EntitlementAuditAction];

// Why a customer may not use a Product. Callers (download, launcher, lease) choose their
// own HTTP error for each reason.
export const EntitlementUsageDenyReason = {
  NOT_FOUND: 'NOT_FOUND',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
  PRODUCT_UNAVAILABLE: 'PRODUCT_UNAVAILABLE',
  PRODUCT_SUSPENDED: 'PRODUCT_SUSPENDED',
} as const;

export type EntitlementUsageDenyReasonValue =
  (typeof EntitlementUsageDenyReason)[keyof typeof EntitlementUsageDenyReason];

export const ENTITLEMENT_REASON_MAX_LENGTH = 2_000;

// The MVP grants the same release access to every Entitlement, whatever its source.
export const ENTITLEMENT_GRANT_SNAPSHOT = {
  schemaVersion: '1.0',
  releaseAccess: 'CURRENT_AND_SUPPORTED',
  allowUpdates: true,
} as const;

export const MILLISECONDS_PER_DAY = 86_400_000;
