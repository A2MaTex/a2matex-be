import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import {
  AdminUserAuditHistory,
  type AdminUserAuditHistoryEntryType,
} from '../../entities/user.model.ts';
import { RoleStatus } from '../../shared/constants/auth.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import type {
  AdminUserDetailRow,
  AdminUserListItemOutputType,
  AdminUserListRow,
  AdminUserStatusTarget,
  AdminUserStatusTransitionInput,
  GetAdminUserDetailOutputType,
  GetAdminUserListInputType,
  GetAdminUserListOutputType,
} from './user.type.ts';
import { RoleName } from '../../shared/constants/role.constant.ts';

export const ADMIN_USER_LIST_SELECT = {
  id: true,
  username: true,
  email: true,
  status: true,
  createdAt: true,
  profile: {
    where: { deletedAt: null },
    select: {
      fullName: true,
    },
  },
  publisherAccount: {
    where: { deletedAt: null },
    select: {
      status: true,
    },
  },
  userRoles: {
    where: {
      deletedAt: null,
    },
    select: {
      role: {
        select: {
          name: true,
        },
      },
    },
  },
} satisfies Prisma.UserSelect;

export const ADMIN_USER_DETAIL_SELECT = {
  id: true,
  username: true,
  email: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  auditHistory: true,
  profile: {
    where: { deletedAt: null },
    select: {
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
    },
  },
  publisherAccount: {
    where: { deletedAt: null },
    select: {
      id: true,
      status: true,
      activatedAt: true,
      blockedReason: true,
      blockedAt: true,
    },
  },
  userRoles: {
    where: {
      deletedAt: null,
    },
    select: {
      role: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
} satisfies Prisma.UserSelect;

export const ADMIN_USER_STATUS_TARGET_SELECT = {
  id: true,
  username: true,
  email: true,
  status: true,
  auditHistory: true,
  userRoles: {
    where: {
      deletedAt: null,
      role: {
        name: RoleName.Admin,
        status: RoleStatus.ACTIVE,
        deletedAt: null,
      },
    },
    select: {
      id: true,
    },
    take: 1,
  },
} satisfies Prisma.UserSelect;

@Injectable()
export class AdminUserRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  async getList(query: GetAdminUserListInputType): Promise<GetAdminUserListOutputType> {
    const { page, pageSize, skip, take } = getPagination(query);
    const where = this.buildListWhere(query);

    const [totalItems, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: ADMIN_USER_LIST_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
    ]);

    return {
      items: users.map((user) => this.toListItem(user)),
      totalItems,
      page,
      pageSize,
      totalPages: Math.ceil(totalItems / pageSize),
    };
  }

  async getDetail(id: string): Promise<GetAdminUserDetailOutputType | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      select: ADMIN_USER_DETAIL_SELECT,
    });

    return user ? this.toDetail(user) : null;
  }

  async getStatusTarget(id: string): Promise<AdminUserStatusTarget | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      select: ADMIN_USER_STATUS_TARGET_SELECT,
    });

    if (!user) {
      return null;
    }

    const { userRoles, ...target } = user;
    return {
      ...target,
      auditHistory: this.parseAuditHistory(target.auditHistory),
      isProtectedAdmin: userRoles.length > 0,
    };
  }

  async transitionStatus({
    id,
    expectedStatus,
    status,
    action,
    reason,
    changedAt,
    changedById,
  }: AdminUserStatusTransitionInput): Promise<boolean> {
    const preparedStatement = Prisma.sql`
      UPDATE "User"
      SET
        "status" = ${status}::"UserStatus",
        "auditHistory" = COALESCE("auditHistory", '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object(
            'action', ${action}::text,
            'reason', ${reason}::text,
            'performedAt', ${changedAt.toISOString()}::text,
            'performedById', ${changedById}::text,
            'details', jsonb_build_object(
              'previousStatus', ${expectedStatus}::text,
              'currentStatus', ${status}::text
            )
          )
        ),
        "updatedAt" = ${changedAt}
      WHERE "id" = ${id}::uuid
        AND "status" = ${expectedStatus}::"UserStatus"
        AND "deletedAt" IS NULL
      RETURNING "id"
    `;
    const changedUsers = await this.prisma.$queryRaw<{ id: string }[]>(preparedStatement);

    return changedUsers.length === 1;
  }

  async revokeAllSessions(userId: string, changedAt: Date): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
    await this.prisma.device.updateMany({
      where: {
        userId,
        deletedAt: null,
      },
      data: {
        isActive: false,
        updatedAt: changedAt,
      },
    });
  }

  private buildListWhere(query: GetAdminUserListInputType): Prisma.UserWhereInput {
    return {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { username: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q, mode: 'insensitive' } },
              {
                profile: {
                  is: {
                    deletedAt: null,
                    fullName: { contains: query.q, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
      ...(query.role
        ? {
            userRoles: {
              some: {
                deletedAt: null,
                role: {
                  name: query.role,
                  status: RoleStatus.ACTIVE,
                  deletedAt: null,
                },
              },
            },
          }
        : {}),
      ...(query.publisherStatus
        ? {
            publisherAccount: {
              is: {
                status: query.publisherStatus,
                deletedAt: null,
              },
            },
          }
        : {}),
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
              ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
            },
          }
        : {}),
    };
  }

  private toListItem(user: AdminUserListRow): AdminUserListItemOutputType {
    const roles = [...new Set(user.userRoles.map(({ role }) => role.name))].sort((left, right) =>
      left.localeCompare(right),
    );

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.profile?.fullName ?? null,
      status: user.status,
      roles,
      publisherStatus: user.publisherAccount?.status ?? null,
      createdAt: user.createdAt,
    };
  }

  private toDetail(user: AdminUserDetailRow): GetAdminUserDetailOutputType {
    const roles = [
      ...new Map(user.userRoles.map(({ role }) => [role.id, role] as const)).values(),
    ].sort((left, right) => left.name.localeCompare(right.name));
    const { profile, publisherAccount } = user;

    return {
      identity: {
        id: user.id,
        username: user.username,
        email: user.email,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      profile: profile
        ? {
            id: profile.id,
            fullName: profile.fullName,
            avatarStaticId: profile.avatarStaticId,
            bio: profile.bio,
            website: profile.website,
            twitter: profile.twitter,
            linkedin: profile.linkedin,
            github: profile.github,
            instagram: profile.instagram,
            gender: profile.gender,
            birthday: profile.birthday,
            address: profile.address,
            phone: profile.phone,
            email: profile.email,
          }
        : null,
      roles,
      publisher: publisherAccount
        ? {
            id: publisherAccount.id,
            status: publisherAccount.status,
            activatedAt: publisherAccount.activatedAt,
            blockedReason: publisherAccount.blockedReason,
            blockedAt: publisherAccount.blockedAt,
          }
        : null,
      entitlements: null,
      auditHistory: this.parseAuditHistory(user.auditHistory),
    };
  }

  private parseAuditHistory(value: Prisma.JsonValue): AdminUserAuditHistoryEntryType[] {
    const result = AdminUserAuditHistory.safeParse(value);
    return result.success ? result.data : [];
  }
}
