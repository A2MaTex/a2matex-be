import { Inject, Injectable } from '@nestjs/common';
import { RoleStatus } from '../../shared/constants/auth.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import {
  ProfileOutputType,
  UpdatePersonalProfileInputType,
} from './profile.model.ts';

@Injectable()
export class ProfileRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  async getMe(userId: string): Promise<ProfileOutputType | null> {
    const profile = await this.prismaService.profile.findFirst({
      where: {
        userId,
        deletedAt: null,
      },
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
        balance: true,
        createdAt: true,
        user: {
          select: {
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
          },
        },
      },
    });

    if (!profile) {
      return null;
    }

    const { user, ...profileData } = profile;
    const roles = [
      ...new Map(user.userRoles.map(({ role }) => [role.id, role] as const)).values(),
    ].sort((left, right) => left.name.localeCompare(right.name));

    return {
      ...profileData,
      roles,
    };
  }

  async updatePersonalProfile({
    userId,
    data,
    fallbackFullName,
  }: {
    userId: string;
    data: UpdatePersonalProfileInputType;
    fallbackFullName: string;
  }) {
    const existingProfile = await this.prismaService.profile.findFirst({
      where: {
        userId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!existingProfile) {
      return this.prismaService.profile.create({
        data: {
          ...data,
          fullName: data.fullName ?? fallbackFullName,
          userId,
          createdById: userId,
          updatedById: userId,
        },
        select: {
          id: true,
        },
      });
    }

    return this.prismaService.profile.update({
      where: {
        id: existingProfile.id,
        deletedAt: null,
      },
      data: {
        ...data,
        updatedById: userId,
        updatedAt: new Date(),
      },
      select: {
        id: true,
      },
    });
  }

  async getUserPassword(userId: string) {
    return this.prismaService.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
      },
      select: {
        id: true,
        username: true,
        password: true,
      },
    });
  }

  async changePassword({ userId, password }: { userId: string; password: string }) {
    return this.prismaService.user.update({
      where: {
        id: userId,
        deletedAt: null,
      },
      data: {
        password,
        updatedAt: new Date(),
      },
      select: {
        id: true,
      },
    });
  }
}
