import { UserStatus } from '../shared/constants/auth.constant.ts';
import { PublisherAccountStatus } from '../shared/constants/publisher.constant.ts';
import { z } from 'zod';
import { Base } from './base.model.ts';

export const AdminUserAuditAction = {
  USER_BANNED: 'USER_BANNED',
  USER_UNBANNED: 'USER_UNBANNED',
  PUBLISHER_BLOCKED: 'PUBLISHER_BLOCKED',
  PUBLISHER_UNBLOCKED: 'PUBLISHER_UNBLOCKED',
} as const;

export const AdminUserStatusAuditDetails = z.object({
  previousStatus: z.enum([UserStatus.ACTIVE, UserStatus.INACTIVE, UserStatus.BANNED]),
  currentStatus: z.enum([UserStatus.ACTIVE, UserStatus.INACTIVE, UserStatus.BANNED]),
});

export const AdminUserStatusAuditEntry = z.object({
  action: z.enum([AdminUserAuditAction.USER_BANNED, AdminUserAuditAction.USER_UNBANNED]),
  details: AdminUserStatusAuditDetails,
});

export const AdminUserPublisherAuditEntry = z.object({
  action: z.enum([
    AdminUserAuditAction.PUBLISHER_BLOCKED,
    AdminUserAuditAction.PUBLISHER_UNBLOCKED,
  ]),
  details: z.object({
    publisherAccountId: z.uuid(),
    previousStatus: z.enum([PublisherAccountStatus.ACTIVE, PublisherAccountStatus.BLOCKED]),
    currentStatus: z.enum([PublisherAccountStatus.ACTIVE, PublisherAccountStatus.BLOCKED]),
    source: z.string().optional(),
  }),
});

export const AdminUserAuditHistoryEntry = z.json();
export const AdminUserAuditHistory = z.array(AdminUserAuditHistoryEntry);

export type AdminUserAuditActionType =
  (typeof AdminUserAuditAction)[keyof typeof AdminUserAuditAction];
export type AdminUserAuditHistoryEntryType = z.infer<typeof AdminUserAuditHistoryEntry>;

export const User = Base.extend({
  username: z.string().min(1).max(100),
  email: z.email(),
  password: z.string().min(6),
  status: z.enum([UserStatus.ACTIVE, UserStatus.INACTIVE, UserStatus.BANNED]),
});

export type UserType = z.infer<typeof User>;
