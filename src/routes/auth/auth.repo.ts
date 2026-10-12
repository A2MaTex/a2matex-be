import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import {
  RoleStatus,
  TypeOfVerificationCodeType,
  UserStatus,
} from '../../shared/constants/auth.constant.ts';
import { UserType } from '../../entities/user.model.ts';
import { ProfileType } from '../../entities/profile.model.ts';
import { WhereUniqueUserType } from '../../shared/repositories/shared-user.repo.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import { VerificationCodeType } from '../../entities/verification.model.ts';
import { RefreshTokenType } from '../../entities/refresh_token.ts';
import { DeviceType } from '../../entities/device.model.ts';

type RefreshTokenWithUserType = RefreshTokenType & {
  user: Pick<UserType, 'status' | 'deletedAt'>;
};

type ExistingRegisterAccountType = Pick<UserType, 'email' | 'username'>;

@Injectable()
export class AuthRepository {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  createUser(
    user: Pick<UserType, 'email' | 'username' | 'password'>,
  ): Promise<Pick<UserType, 'id'>> {
    return this.prisma.user.create({
      data: {
        ...user,
        status: UserStatus.ACTIVE,
      },
      select: {
        id: true,
      },
    });
  }

  createUserIncludeRole(
    user: Pick<UserType, 'email' | 'username' | 'password'> & {
      fullName: ProfileType['fullName'];
      roleId: string;
    },
  ): Promise<Pick<UserType, 'id'>> {
    const { fullName, roleId, ...userData } = user;
    const userId = randomUUID();

    return this.prisma.user.create({
      data: {
        id: userId,
        ...userData,
        status: UserStatus.ACTIVE,
        profile: {
          create: {
            fullName,
            email: userData.email,
            createdById: userId,
          },
        },
        userRoles: {
          create: {
            roleId,
          },
        },
      },
      select: {
        id: true,
      },
    });
  }

  findExistingRegisterAccounts({
    email,
    username,
  }: Pick<UserType, 'email' | 'username'>): Promise<ExistingRegisterAccountType[]> {
    return this.prisma.user.findMany({
      where: {
        deletedAt: null,
        OR: [
          {
            email: {
              equals: email,
              mode: 'insensitive',
            },
          },
          {
            username: {
              equals: username,
              mode: 'insensitive',
            },
          },
        ],
      },
      select: {
        email: true,
        username: true,
      },
    });
  }

  async createVerificationCode(
    payload: Pick<VerificationCodeType, 'email' | 'type' | 'code' | 'expiresAt'>,
  ): Promise<Pick<VerificationCodeType, 'id'>> {
    const [verificationCode] = await this.prisma.$queryRaw<Pick<VerificationCodeType, 'id'>[]>`
      INSERT INTO "VerificationCode" (email, type, code, "expiresAt")
      VALUES (${payload.email}, ${payload.type}::"VerificationCodeType", ${payload.code}, ${payload.expiresAt})
      ON CONFLICT (email, type) WHERE "deletedAt" IS NULL
      DO UPDATE SET
        code = EXCLUDED.code,
        "expiresAt" = EXCLUDED."expiresAt",
        "updatedAt" = now()
      RETURNING id;
    `;

    return verificationCode;
  }

  findUniqueVerificationCode(
    uniqueValue:
      | { id: string }
      | {
          email_type: {
            email: string;
            type: TypeOfVerificationCodeType;
          };
        },
  ): Promise<VerificationCodeType | null> {
    return this.prisma.verificationCode.findUnique({
      where: uniqueValue,
    });
  }

  createRefreshToken(data: {
    id: string;
    token: string;
    userId: string;
    expiresAt: Date;
    deviceId: string;
  }): Promise<Pick<RefreshTokenType, 'id'>> {
    return this.prisma.refreshToken.create({
      data,
      select: {
        id: true,
      },
    });
  }

  createDevice(
    data: Pick<DeviceType, 'userId' | 'userAgent' | 'ip' | 'lastActive'> &
      Partial<Pick<DeviceType, 'isActive'>>,
  ): Promise<Pick<DeviceType, 'id'>> {
    return this.prisma.device
      .findFirst({
        where: {
          userId: data.userId,
          deletedAt: null,
        },
        select: {
          id: true,
        },
      })
      .then((device) => {
        if (!device) {
          return this.prisma.device.create({
            data,
            select: {
              id: true,
            },
          });
        }

        return this.prisma.device.update({
          where: {
            id: device.id,
          },
          data: {
            userAgent: data.userAgent,
            ip: data.ip,
            lastActive: data.lastActive,
            isActive: data.isActive ?? true,
            updatedAt: new Date(),
          },
          select: {
            id: true,
          },
        });
      });
  }

  findUniqueUserWithActiveRole(
    where: WhereUniqueUserType | { account: string },
  ): Promise<UserType | null> {
    return this.prisma.user.findFirst({
      where: {
        ...('account' in where
          ? {
              OR: [
                {
                  email: where.account,
                },
                {
                  username: where.account,
                },
              ],
            }
          : where),
        deletedAt: null,
        userRoles: {
          some: {
            deletedAt: null,
            role: {
              status: RoleStatus.ACTIVE,
              deletedAt: null,
            },
          },
        },
      },
    });
  }

  findUniqueRefreshTokenIncludeUser(token: string): Promise<RefreshTokenWithUserType | null> {
    return this.prisma.refreshToken
      .findUnique({
        where: { token },
        include: {
          user: {
            select: {
              status: true,
              deletedAt: true,
              userRoles: {
                where: {
                  deletedAt: null,
                  role: {
                    status: RoleStatus.ACTIVE,
                    deletedAt: null,
                  },
                },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      })
      .then((refreshToken) => {
        if (!refreshToken?.user || !refreshToken.userId || !refreshToken.deviceId) {
          return null;
        }

        if (refreshToken.user.deletedAt || refreshToken.user.userRoles.length === 0) {
          return null;
        }

        const { userRoles: _userRoles, ...userData } = refreshToken.user;
        return {
          ...refreshToken,
          userId: refreshToken.userId,
          deviceId: refreshToken.deviceId,
          user: userData,
        };
      });
  }

  updateDevice(deviceId: string, data: Partial<DeviceType>): Promise<Pick<DeviceType, 'id'>> {
    return this.prisma.device.update({
      where: {
        id: deviceId,
      },
      data,
      select: {
        id: true,
      },
    });
  }

  deleteRefreshToken(
    where: { id: string } | { token: string },
  ): Promise<Pick<RefreshTokenType, 'id'>> {
    return this.prisma.refreshToken.delete({
      where,
      select: {
        id: true,
      },
    });
  }

  deleteVerificationCode(
    uniqueValue:
      | { id: string }
      | {
          email_type: {
            email: string;
            type: TypeOfVerificationCodeType;
          };
        },
  ): Promise<VerificationCodeType> {
    return this.prisma.verificationCode.delete({
      where: uniqueValue,
    });
  }
}
