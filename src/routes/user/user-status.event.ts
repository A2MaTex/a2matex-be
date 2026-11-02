import { z } from 'zod';
import { UserStatus } from '../../shared/constants/auth.constant.ts';

export const ADMIN_USER_BANNED_EVENT_TYPE = 'admin.user.banned.v1';
export const ADMIN_USER_UNBANNED_EVENT_TYPE = 'admin.user.unbanned.v1';

export const AdminUserBannedEventPayload = z
  .object({
    userId: z.uuid(),
    username: z.string().min(1),
    email: z.email(),
    status: z.literal(UserStatus.BANNED),
    reason: z.string().min(1),
    changedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type AdminUserBannedEventPayloadType = z.infer<typeof AdminUserBannedEventPayload>;

export const AdminUserUnbannedEventPayload = z
  .object({
    userId: z.uuid(),
    username: z.string().min(1),
    email: z.email(),
    status: z.enum([UserStatus.ACTIVE, UserStatus.INACTIVE]),
    reason: z.string().min(1),
    changedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type AdminUserUnbannedEventPayloadType = z.infer<typeof AdminUserUnbannedEventPayload>;
