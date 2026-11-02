import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import { RoleStatus } from '../../shared/constants/auth.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import type {
  AdminUserListItemOutputType,
  GetAdminUserDetailOutputType,
  GetAdminUserListInputType,
  GetAdminUserListOutputType,
} from './user.model.ts';
import { RoleName } from '../../shared/constants/role.constant.ts';
import type { UserStatus } from '../../generated/prisma/client.ts';

const ADMIN_USER_LIST_SELECT = {
  id: true,
  username: true,
  email: true,
  status: true,
  createdAt: true,
  profile: {
    select: {
      fullName: true,
      deletedAt: true,
    },
  },
  publisherAccount: {
    select: {
      status: true,
      deletedAt: true,
    },
  },
  userRoles: {
    where: {
      deletedAt: null,
      role: {
        status: RoleStatus.ACTIVE,
        deletedAt: null,
      },
    },
    select: {
      role: {
        select: {
          name: true,
        },
      },
    },
  },
  _count: {
    select: {
      device: {
        where: {
          isActive: true,
          deletedAt: null,
        },
      },
    },
  },
  device: {
    where: {
      deletedAt: null,
    },
    orderBy: [{ lastActive: 'desc' }, { id: 'desc' }],
    take: 1,
    select: {
      lastActive: true,
    },
  },
} satisfies Prisma.UserSelect;

type AdminUserListRow = Prisma.UserGetPayload<{ select: typeof ADMIN_USER_LIST_SELECT }>;

const ADMIN_USER_DETAIL_SELECT = {
  id: true,
  username: true,
  email: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  previousStatus: true,
  statusReason: true,
  statusChangedAt: true,
  statusChangedById: true,
  profile: {
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
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
    },
  },
  publisherAccount: {
    select: {
      id: true,
      status: true,
      activatedAt: true,
      blockedReason: true,
      blockedAt: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
    },
  },
  userRoles: {
    where: {
      deletedAt: null,
      role: {
        status: RoleStatus.ACTIVE,
        deletedAt: null,
      },
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
  _count: {
    select: {
      device: {
        where: {
          isActive: true,
          deletedAt: null,
        },
      },
    },
  },
  device: {
    where: {
      deletedAt: null,
    },
    orderBy: [{ lastActive: 'desc' }, { id: 'desc' }],
    take: 1,
    select: {
      lastActive: true,
    },
  },
} satisfies Prisma.UserSelect;

type AdminUserDetailRow = Prisma.UserGetPayload<{ select: typeof ADMIN_USER_DETAIL_SELECT }>;

const ADMIN_USER_STATUS_TARGET_SELECT = {
  id: true,
  username: true,
  email: true,
  status: true,
  previousStatus: true,
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

type AdminUserStatusTargetRow = Prisma.UserGetPayload<{
  select: typeof ADMIN_USER_STATUS_TARGET_SELECT;
}>;

export type AdminUserStatusTarget = Omit<AdminUserStatusTargetRow, 'userRoles'> & {
  isProtectedAdmin: boolean;
};

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
      isProtectedAdmin: userRoles.length > 0,
    };
  }

  async transitionStatus({
    id,
    expectedStatus,
    status,
    reason,
    changedAt,
    changedById,
  }: {
    id: string;
    expectedStatus: UserStatus;
    status: UserStatus;
    reason: string;
    changedAt: Date;
    changedById: string;
  }): Promise<boolean> {
    const result = await this.prisma.user.updateMany({
      where: {
        id,
        status: expectedStatus,
        deletedAt: null,
      },
      data: {
        previousStatus: expectedStatus,
        status,
        statusReason: reason,
        statusChangedAt: changedAt,
        statusChangedById: changedById,
        updatedAt: changedAt,
      },
    });

    return result.count === 1;
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
      displayName: user.profile?.deletedAt ? null : (user.profile?.fullName ?? null),
      status: user.status,
      roles,
      publisherStatus: user.publisherAccount?.deletedAt
        ? null
        : (user.publisherAccount?.status ?? null),
      activeSessionCount: user._count.device,
      lastActiveAt: user.device[0]?.lastActive ?? null,
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
      profile:
        profile && !profile.deletedAt
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
              createdAt: profile.createdAt,
              updatedAt: profile.updatedAt,
            }
          : null,
      roles,
      publisher:
        publisherAccount && !publisherAccount.deletedAt
          ? {
              id: publisherAccount.id,
              status: publisherAccount.status,
              activatedAt: publisherAccount.activatedAt,
              blockedReason: publisherAccount.blockedReason,
              blockedAt: publisherAccount.blockedAt,
              createdAt: publisherAccount.createdAt,
              updatedAt: publisherAccount.updatedAt,
            }
          : null,
      sessions: {
        activeCount: user._count.device,
        lastActiveAt: user.device[0]?.lastActive ?? null,
      },
      entitlements: null,
      orders: null,
      moderation:
        user.previousStatus && user.statusReason && user.statusChangedAt && user.statusChangedById
          ? {
              previousStatus: user.previousStatus,
              currentStatus: user.status,
              reason: user.statusReason,
              changedAt: user.statusChangedAt,
              changedById: user.statusChangedById,
            }
          : null,
    };
  }
}
