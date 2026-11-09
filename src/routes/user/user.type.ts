import type { z } from 'zod';
import type { Prisma, UserStatus } from '../../generated/prisma/client.ts';
import type { AdminUserAuditHistoryEntryType } from '../../entities/user.model.ts';
import type { PublisherAccountStatusType } from '../../shared/constants/publisher.constant.ts';
import type { AdminUserAuditActionType } from '../../shared/constants/user.constant.ts';
import type {
  AdminUserListItemOutput,
  GetAdminUserDetailOutput,
  GetAdminUserListInput,
  GetAdminUserListOutput,
  UpdateAdminUserStatusInput,
} from './user.model.ts';
import type {
  ADMIN_USER_DETAIL_SELECT,
  ADMIN_USER_LIST_SELECT,
  ADMIN_USER_STATUS_TARGET_SELECT,
} from './user.repo.ts';

export type GetAdminUserListInputType = z.infer<typeof GetAdminUserListInput>;
export type GetAdminUserListOutputType = z.infer<typeof GetAdminUserListOutput>;
export type AdminUserListItemOutputType = z.infer<typeof AdminUserListItemOutput>;
export type GetAdminUserDetailOutputType = z.infer<typeof GetAdminUserDetailOutput>;
export type UpdateAdminUserStatusInputType = z.infer<typeof UpdateAdminUserStatusInput>;

export type AdminUserListRow = Prisma.UserGetPayload<{
  select: typeof ADMIN_USER_LIST_SELECT;
}>;

export type AdminUserDetailRow = Prisma.UserGetPayload<{
  select: typeof ADMIN_USER_DETAIL_SELECT;
}>;

type AdminUserStatusTargetRow = Prisma.UserGetPayload<{
  select: typeof ADMIN_USER_STATUS_TARGET_SELECT;
}>;

export type AdminUserStatusTarget = Omit<AdminUserStatusTargetRow, 'userRoles' | 'auditHistory'> & {
  auditHistory: AdminUserAuditHistoryEntryType[];
  isProtectedAdmin: boolean;
};

export type AdminUserStatusTransitionInput = {
  id: string;
  expectedStatus: UserStatus;
  status: UserStatus;
  action: AdminUserAuditActionType;
  reason: string;
  changedAt: Date;
  changedById: string;
};

export type UpdateAdminUserStatusParams = {
  userId: string;
  adminUserId: string;
  data: UpdateAdminUserStatusInputType;
};

export type AdminUserStatusChangeContext = UpdateAdminUserStatusParams & {
  target: AdminUserStatusTarget;
  changedAt: Date;
};

export type PublisherStatusCascadeParams = {
  userId: string;
  reason: string;
  changedAt: Date;
  changedById: string;
};

export type UserStatusNotificationParams = {
  userId: string;
  username: string;
  email: string;
  reason: string;
  changedAt: Date;
};

export type UserUnbanNotificationParams = UserStatusNotificationParams & {
  status: Extract<UserStatus, 'ACTIVE'>;
};

export type UserStatusNotificationTask = {
  userId: string;
  type: 'ban' | 'unban';
  send: () => Promise<{ error: unknown }>;
};
