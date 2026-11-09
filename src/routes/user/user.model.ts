import { z } from 'zod';
import { Profile } from '../../entities/profile.model.ts';
import { PublisherAccount } from '../../entities/publisher-account.model.ts';
import { Role } from '../../entities/role.schema.ts';
import { AdminUserAuditHistory, User } from '../../entities/user.model.ts';
import { UserStatus } from '../../shared/constants/auth.constant.ts';
import { PublisherAccountStatus } from '../../shared/constants/publisher.constant.ts';
import { RoleName } from '../../shared/constants/role.constant.ts';

export const ADMIN_USER_SEARCH_MAX_LENGTH = 255;
export const ADMIN_USER_PAGE_SIZE_MAX = 100;

const IsoDateTimeQuery = z.iso.datetime({ offset: true });

export const AdminUserIdParam = z
  .object({
    userId: z.uuid(),
  })
  .strict();

export const UpdateAdminUserStatusInput = z
  .object({
    status: z.enum([UserStatus.ACTIVE, UserStatus.BANNED]),
    reason: z.string().trim().min(1),
  })
  .strict();

export const GetAdminUserListInput = z
  .object({
    q: z.string().trim().min(1).max(ADMIN_USER_SEARCH_MAX_LENGTH).optional(),
    status: z.enum([UserStatus.ACTIVE, UserStatus.INACTIVE, UserStatus.BANNED]).optional(),
    role: z.enum([RoleName.Customer, RoleName.Publisher, RoleName.Admin]).optional(),
    publisherStatus: z
      .enum([PublisherAccountStatus.ACTIVE, PublisherAccountStatus.BLOCKED])
      .optional(),
    createdFrom: IsoDateTimeQuery.optional(),
    createdTo: IsoDateTimeQuery.optional(),
    page: z.coerce.number().int().positive().safe().default(1),
    pageSize: z.coerce.number().int().positive().safe().max(ADMIN_USER_PAGE_SIZE_MAX).default(10),
  })
  .strict()
  .superRefine(({ createdFrom, createdTo }, ctx) => {
    if (createdFrom && createdTo && Date.parse(createdFrom) > Date.parse(createdTo)) {
      ctx.addIssue({
        code: 'custom',
        message: 'createdFrom must be earlier than or equal to createdTo',
        path: ['createdFrom'],
      });
    }
  });

export const AdminUserListItemOutput = User.pick({
  id: true,
  username: true,
  email: true,
  status: true,
  createdAt: true,
}).extend({
  displayName: z.string().nullable(),
  roles: z.array(z.string()),
  publisherStatus: z
    .enum([PublisherAccountStatus.ACTIVE, PublisherAccountStatus.BLOCKED])
    .nullable(),
});

export const GetAdminUserListOutput = z.object({
  items: z.array(AdminUserListItemOutput),
  totalItems: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

export const AdminUserIdentityOutput = User.pick({
  id: true,
  username: true,
  email: true,
  status: true,
  createdAt: true,
  updatedAt: true,
});

export const AdminUserProfileOutput = Profile.pick({
  id: true,
  fullName: true,
  avatarStaticId: true,
  bio: true,
  website: true,
  twitter: true,
  linkedin: true,
  github: true,
  instagram: true,
  gender: true,
  birthday: true,
  address: true,
  phone: true,
  email: true,
});

export const AdminUserRoleOutput = Role.pick({
  id: true,
  name: true,
});

export const AdminUserPublisherOutput = PublisherAccount.pick({
  id: true,
  status: true,
  activatedAt: true,
  blockedReason: true,
  blockedAt: true,
});

export const AdminUserEntitlementSummaryOutput = z
  .object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    expired: z.number().int().nonnegative(),
    revoked: z.number().int().nonnegative(),
  })
  .nullable();

export const GetAdminUserDetailOutput = z.object({
  identity: AdminUserIdentityOutput,
  profile: AdminUserProfileOutput.nullable(),
  roles: z.array(AdminUserRoleOutput),
  publisher: AdminUserPublisherOutput.nullable(),
  entitlements: AdminUserEntitlementSummaryOutput,
  auditHistory: AdminUserAuditHistory,
});
