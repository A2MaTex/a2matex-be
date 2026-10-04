import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.ts';
import type { UserStatus as PrismaUserStatus } from '../../generated/prisma/enums.ts';
import type { PublisherAccountStatusType } from '../../shared/constants/publisher.constant.ts';
import { TermStatus, TermType } from '../../shared/constants/publisher.constant.ts';
import { RoleName } from '../../shared/constants/role.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import type { GetPublisherListInputType } from './publisher.model.ts';

type LockedUser = {
  id: string;
  status: PrismaUserStatus;
};

type LockedPublisherAccount = {
  id: string;
  userId: string;
  status: PublisherAccountStatusType;
};

@Injectable()
export class PublisherRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  async lockUser(userId: string): Promise<LockedUser | null> {
    const [user] = await this.prisma.$queryRaw<LockedUser[]>`
      SELECT id, status
      FROM "User"
      WHERE id = ${userId}::uuid AND "deletedAt" IS NULL
      FOR UPDATE
    `;
    return user ?? null;
  }

  async lockPublisherAccount(id: string): Promise<LockedPublisherAccount | null> {
    const [account] = await this.prisma.$queryRaw<LockedPublisherAccount[]>`
      SELECT id, "userId", status
      FROM "PublisherAccount"
      WHERE id = ${id}::uuid AND "deletedAt" IS NULL
      FOR UPDATE
    `;
    return account ?? null;
  }

  getUserProfile(userId: string) {
    return this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        username: true,
        status: true,
        profile: {
          select: {
            fullName: true,
            email: true,
            avatarStaticId: true,
            bio: true,
            website: true,
            twitter: true,
            linkedin: true,
            github: true,
            instagram: true,
            deletedAt: true,
          },
        },
      },
    });
  }

  getAccountByUserId(userId: string) {
    return this.prisma.publisherAccount.findFirst({
      where: { userId, deletedAt: null },
      select: {
        id: true,
        userId: true,
        status: true,
        activatedAt: true,
        blockedReason: true,
        blockedAt: true,
        blockedById: true,
      },
    });
  }

  getAccountById(id: string) {
    return this.prisma.publisherAccount.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, userId: true, status: true },
    });
  }

  getActivePublisherTerm() {
    return this.prisma.term.findFirst({
      where: {
        type: 'PUBLISHER_TERMS',
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true, version: true, title: true },
    });
  }

  getActivePublisherTermById(id: string) {
    return this.prisma.term.findFirst({
      where: {
        id,
        type: 'PUBLISHER_TERMS',
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true, version: true, title: true },
    });
  }

  async hasAcceptedTerm({
    publisherAccountId,
    termId,
  }: {
    publisherAccountId: string;
    termId: string;
  }) {
    const acceptance = await this.prisma.publisherTermsAcceptance.findUnique({
      where: {
        publisherAccountId_termId: { publisherAccountId, termId },
      },
      select: { id: true },
    });
    return Boolean(acceptance);
  }

  createAccount(userId: string) {
    return this.prisma.publisherAccount.create({
      data: { userId },
      select: {
        id: true,
        userId: true,
        status: true,
        activatedAt: true,
        blockedReason: true,
        blockedAt: true,
        blockedById: true,
      },
    });
  }

  ensureAcceptance({
    publisherAccountId,
    termId,
    acceptanceMetadata,
  }: {
    publisherAccountId: string;
    termId: string;
    acceptanceMetadata: Prisma.InputJsonObject;
  }) {
    return this.prisma.publisherTermsAcceptance.createMany({
      data: [{ publisherAccountId, termId, acceptanceMetadata }],
      skipDuplicates: true,
    });
  }

  getActivePublisherRole() {
    return this.prisma.role.findFirst({
      where: {
        name: RoleName.Publisher,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true },
    });
  }

  async ensureUserRole({ userId, roleId }: { userId: string; roleId: string }) {
    const activeUserRole = await this.prisma.userRole.findFirst({
      where: { userId, roleId, deletedAt: null },
      select: { id: true },
    });
    if (activeUserRole) {
      return activeUserRole;
    }

    const deletedUserRole = await this.prisma.userRole.findFirst({
      where: { userId, roleId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      select: { id: true },
    });
    if (deletedUserRole) {
      return this.prisma.userRole.update({
        where: { id: deletedUserRole.id },
        data: { deletedAt: null, updatedAt: new Date() },
        select: { id: true },
      });
    }

    return this.prisma.userRole.create({
      data: { userId, roleId },
      select: { id: true },
    });
  }

  async getList(query: GetPublisherListInputType) {
    const { page, pageSize, skip, take } = getPagination(query);
    const where = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
    };
    const [totalItems, accounts] = await Promise.all([
      this.prisma.publisherAccount.count({ where }),
      this.prisma.publisherAccount.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          status: true,
          activatedAt: true,
          blockedReason: true,
          blockedAt: true,
          user: {
            select: {
              id: true,
              username: true,
              status: true,
              profile: {
                select: { fullName: true, email: true, deletedAt: true },
              },
            },
          },
        },
      }),
    ]);

    return {
      items: accounts.map(({ user, ...account }) => ({
        ...account,
        user: { id: user.id, username: user.username, status: user.status },
        profile: user.profile?.deletedAt
          ? null
          : user.profile && { fullName: user.profile.fullName, email: user.profile.email },
      })),
      totalItems,
      page,
      pageSize,
      totalPages: Math.ceil(totalItems / pageSize),
    };
  }

  async getDetail(id: string) {
    const account = await this.prisma.publisherAccount.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        activatedAt: true,
        blockedReason: true,
        blockedAt: true,
        blockedById: true,
        user: {
          select: {
            id: true,
            username: true,
            status: true,
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
                deletedAt: true,
              },
            },
            userRoles: {
              where: { deletedAt: null, role: { deletedAt: null } },
              select: { role: { select: { id: true, name: true, status: true } } },
            },
          },
        },
        termsAcceptances: {
          orderBy: { acceptedAt: 'desc' },
          select: {
            acceptedAt: true,
            term: {
              select: {
                id: true,
                type: true,
                version: true,
                title: true,
                status: true,
                deletedAt: true,
              },
            },
          },
        },
      },
    });
    if (!account) {
      return null;
    }

    const { user, termsAcceptances, ...accountData } = account;
    const profile =
      user.profile && !user.profile.deletedAt
        ? {
            id: user.profile.id,
            fullName: user.profile.fullName,
            avatarStaticId: user.profile.avatarStaticId,
            bio: user.profile.bio,
            website: user.profile.website,
            twitter: user.profile.twitter,
            linkedin: user.profile.linkedin,
            github: user.profile.github,
            instagram: user.profile.instagram,
            gender: user.profile.gender,
            birthday: user.profile.birthday,
            address: user.profile.address,
            phone: user.profile.phone,
            email: user.profile.email,
            createdAt: user.profile.createdAt,
          }
        : null;
    const acceptedCurrentTerms = termsAcceptances.some(({ term }) => {
      return (
        term.type === TermType.PUBLISHER_TERMS &&
        term.status === TermStatus.ACTIVE &&
        term.deletedAt === null
      );
    });

    return {
      ...accountData,
      user: { id: user.id, username: user.username, status: user.status },
      profile,
      acceptedCurrentTerms,
      roles: user.userRoles.map(({ role }) => role),
      acceptedTerms: termsAcceptances.map(({ acceptedAt, term }) => ({
        id: term.id,
        type: term.type,
        version: term.version,
        title: term.title,
        acceptedAt,
      })),
    };
  }

  updateStatus({
    id,
    status,
    actorId,
    reason,
  }: {
    id: string;
    status: PublisherAccountStatusType;
    actorId: string;
    reason?: string;
  }) {
    const now = new Date();
    return this.prisma.publisherAccount.update({
      where: { id },
      data:
        status === 'BLOCKED'
          ? {
              status,
              blockedReason: reason,
              blockedAt: now,
              blockedById: actorId,
              updatedAt: now,
            }
          : {
              status,
              blockedReason: null,
              blockedAt: null,
              blockedById: null,
              updatedAt: now,
            },
      select: { id: true },
    });
  }

  getPublicByUsername(username: string) {
    return this.prisma.publisherAccount.findFirst({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        user: {
          username: { equals: username, mode: 'insensitive' },
          status: 'ACTIVE',
          deletedAt: null,
          profile: { is: { deletedAt: null } },
          userRoles: {
            some: {
              deletedAt: null,
              role: {
                name: RoleName.Publisher,
                status: 'ACTIVE',
                deletedAt: null,
              },
            },
          },
        },
      },
      select: {
        user: {
          select: {
            username: true,
            profile: {
              select: {
                fullName: true,
                email: true,
                avatarStaticId: true,
                bio: true,
                website: true,
                twitter: true,
                linkedin: true,
                github: true,
                instagram: true,
              },
            },
          },
        },
      },
    });
  }

  getAccessState(userId: string) {
    return this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        status: true,
        userRoles: {
          where: {
            deletedAt: null,
            role: {
              name: RoleName.Publisher,
              status: 'ACTIVE',
              deletedAt: null,
            },
          },
          select: { id: true },
          take: 1,
        },
        publisherAccount: {
          select: {
            id: true,
            status: true,
            deletedAt: true,
            termsAcceptances: {
              where: {
                term: {
                  type: 'PUBLISHER_TERMS',
                  status: 'ACTIVE',
                  deletedAt: null,
                },
              },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    });
  }
}
