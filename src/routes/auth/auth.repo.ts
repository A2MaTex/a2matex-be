import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { TypeOfVerificationCodeType, UserStatus } from '../../shared/constants/auth.constant.ts';
import { RoleType } from '../../entities/role.schema.ts';
import { UserType } from '../../entities/user.model.ts';
import { ProfileType } from '../../entities/profile.model.ts';
import { WhereUniqueUserType } from '../../shared/repositories/shared-user.repo.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import { VerificationCodeType } from '../../entities/verification.model.ts';
import { RefreshTokenType } from '../../entities/refresh_token.ts';
import { DeviceType } from '../../entities/device.model.ts';

type UserWithRoleType = UserType & { roleId: string; role: RoleType };
type RefreshTokenWithUserRoleType = RefreshTokenType & {
  user: UserWithRoleType;
};

type ExistingRegisterAccountType = Pick<UserType, 'email' | 'username'>;

@Injectable()
export class AuthRepository {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  createUser(
    user: Pick<UserType, 'email' | 'username' | 'password'>,
  ): Promise<Pick<UserType, 'id'>> {
    return this.prismaService.user.create({
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

    return this.prismaService.user.create({
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
    return this.prismaService.user.findMany({
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
    const [verificationCode] = await this.prismaService.$queryRaw<
      Pick<VerificationCodeType, 'id'>[]
    >`
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
    return this.prismaService.verificationCode.findUnique({
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
    return this.prismaService.refreshToken.create({
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
    return this.prismaService.device
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
          return this.prismaService.device.create({
            data,
            select: {
              id: true,
            },
          });
        }

        return this.prismaService.device.update({
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

  findUniqueUserIncludeRole(
    where: WhereUniqueUserType | { account: string },
  ): Promise<UserWithRoleType | null> {
    return this.prismaService.user
      .findFirst({
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
        },
        include: {
          userRoles: {
            where: {
              deletedAt: null,
              role: {
                deletedAt: null,
              },
            },
            include: {
              role: true,
            },
            take: 1,
          },
        },
      })
      .then((user) => {
        if (!user) {
          return null;
        }

        const userRole = user.userRoles[0];
        if (!userRole) {
          return null;
        }

        const { userRoles, ...userData } = user;
        return {
          ...userData,
          roleId: userRole.roleId,
          role: userRole.role as RoleType,
        };
      });
  }

  findUniqueRefreshTokenIncludeUserRole(
    token: string,
  ): Promise<RefreshTokenWithUserRoleType | null> {
    return this.prismaService.refreshToken
      .findUnique({
        where: { token },
        include: {
          user: {
            include: {
              userRoles: {
                where: {
                  deletedAt: null,
                  role: {
                    deletedAt: null,
                  },
                },
                include: {
                  role: true,
                },
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

        const userRole = refreshToken.user.userRoles[0];
        if (!userRole) {
          return null;
        }

        const { userRoles, ...userData } = refreshToken.user;
        return {
          ...refreshToken,
          userId: refreshToken.userId,
          deviceId: refreshToken.deviceId,
          user: {
            ...userData,
            roleId: userRole.roleId,
            role: userRole.role as RoleType,
          },
        };
      });
  }

  updateDevice(deviceId: string, data: Partial<DeviceType>): Promise<Pick<DeviceType, 'id'>> {
    return this.prismaService.device.update({
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
    return this.prismaService.refreshToken.delete({
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
    return this.prismaService.verificationCode.delete({
      where: uniqueValue,
    });
  }
}
