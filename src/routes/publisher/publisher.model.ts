import { z } from 'zod';
import { PublisherAccount } from '../../entities/publisher-account.model.ts';
import { Profile } from '../../entities/profile.model.ts';
import {
  PUBLISHER_REQUIRED_PROFILE_FIELDS,
  PublisherAccountStatus,
} from '../../shared/constants/publisher.constant.ts';
import { RoleStatus, UserStatus } from '../../shared/constants/auth.constant.ts';
import { TermType } from '../../shared/constants/publisher.constant.ts';
import { zDate } from '../../shared/utils/zod.ts';

export const PublisherAccountIdParam = z
  .object({
    publisherAccountId: z.uuid(),
  })
  .strict();

export const PublisherUsernameParam = z
  .object({
    username: z.string().min(1).max(255),
  })
  .strict();

export const PublisherAccountSummary = PublisherAccount.pick({
  id: true,
  status: true,
  activatedAt: true,
  blockedReason: true,
  blockedAt: true,
});

export const CurrentPublisherTermSummary = z.object({
  id: z.uuid(),
  version: z.string(),
  title: z.string(),
});

const PublisherProfileFields = z.object({
  username: z.string(),
  fullName: z.string(),
  avatarStaticId: z.uuid().nullable(),
  bio: z.string().nullable(),
  website: z.string().nullable(),
  twitter: z.string().nullable(),
  linkedin: z.string().nullable(),
  github: z.string().nullable(),
  instagram: z.string().nullable(),
});

export const PublisherProfileOutput = PublisherProfileFields.extend({
  email: z.string().nullable(),
});

export const GetMyPublisherOutput = z.object({
  publisherAccount: PublisherAccountSummary.nullable(),
  missingFields: z.array(z.enum(PUBLISHER_REQUIRED_PROFILE_FIELDS)),
  acceptedCurrentTerms: z.boolean(),
  currentTerms: CurrentPublisherTermSummary.nullable(),
  profile: PublisherProfileOutput.nullable(),
});

export const ActivatePublisherInput = z
  .object({
    termId: z.uuid(),
  })
  .strict();

export const GetPublisherListInput = z
  .object({
    status: z.enum([PublisherAccountStatus.ACTIVE, PublisherAccountStatus.BLOCKED]).optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(10),
  })
  .strict();

const PublisherAdminUser = z.object({
  id: z.uuid(),
  username: z.string(),
  status: z.enum([UserStatus.ACTIVE, UserStatus.INACTIVE, UserStatus.BANNED]),
});

const PublisherAdminProfile = z.object({
  fullName: z.string(),
  email: z.string().nullable(),
});

const PublisherAdminDetailProfile = Profile.pick({
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
  createdAt: true,
});

export const PublisherAdminListItem = PublisherAccountSummary.extend({
  user: PublisherAdminUser,
  profile: PublisherAdminProfile.nullable(),
});

export const GetPublisherListOutput = z.object({
  items: z.array(PublisherAdminListItem),
  totalItems: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

export const PublisherAdminDetailOutput = PublisherAdminListItem.extend({
  profile: PublisherAdminDetailProfile.nullable(),
  blockedById: z.uuid().nullable(),
  acceptedCurrentTerms: z.boolean(),
  roles: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      status: z.enum([RoleStatus.ACTIVE, RoleStatus.INACTIVE]),
    }),
  ),
  acceptedTerms: z.array(
    z.object({
      id: z.uuid(),
      type: z.enum([TermType.PUBLISHER_TERMS, TermType.CUSTOMER_TERMS, TermType.PRIVACY_POLICY]),
      version: z.string(),
      title: z.string(),
      acceptedAt: zDate(),
    }),
  ),
});

export const UpdatePublisherStatusInput = z
  .object({
    status: z.enum([PublisherAccountStatus.ACTIVE, PublisherAccountStatus.BLOCKED]),
    expectedStatus: z
      .enum([PublisherAccountStatus.ACTIVE, PublisherAccountStatus.BLOCKED])
      .optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .superRefine(({ reason, status }, ctx) => {
    if (status === PublisherAccountStatus.BLOCKED && !reason) {
      ctx.addIssue({
        code: 'custom',
        message: 'Reason is required when blocking a publisher',
        path: ['reason'],
      });
    }
    if (status === PublisherAccountStatus.ACTIVE && reason !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Reason is not allowed when activating a publisher',
        path: ['reason'],
      });
    }
  });

export const PublicPublisherOutput = PublisherProfileFields.extend({
  email: z.email(),
});

export type ActivatePublisherInputType = z.infer<typeof ActivatePublisherInput>;
export type GetPublisherListInputType = z.infer<typeof GetPublisherListInput>;
export type UpdatePublisherStatusInputType = z.infer<typeof UpdatePublisherStatusInput>;
export type MissingPublisherProfileField = (typeof PUBLISHER_REQUIRED_PROFILE_FIELDS)[number];
