import { Inject, Injectable } from '@nestjs/common';
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
    });

    return profile as ProfileOutputType | null;
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
