export const EntitlementStatus = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
} as const;

export type EntitlementStatusValue = (typeof EntitlementStatus)[keyof typeof EntitlementStatus];

export const EntitlementGrantSource = {
  FREE_ACQUISITION: 'FREE_ACQUISITION',
  ORDER: 'ORDER',
  ADMIN_GRANT: 'ADMIN_GRANT',
} as const;

export type EntitlementGrantSourceValue =
  (typeof EntitlementGrantSource)[keyof typeof EntitlementGrantSource];

export const ENTITLEMENT_GRANT_SNAPSHOT_SCHEMA_VERSION = '1.0';
