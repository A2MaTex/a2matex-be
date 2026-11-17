export const AdminUserAuditAction = {
  USER_BANNED: 'USER_BANNED',
  USER_UNBANNED: 'USER_UNBANNED',
  PUBLISHER_BLOCKED: 'PUBLISHER_BLOCKED',
  PUBLISHER_UNBLOCKED: 'PUBLISHER_UNBLOCKED',
} as const;

export type AdminUserAuditActionType =
  (typeof AdminUserAuditAction)[keyof typeof AdminUserAuditAction];
