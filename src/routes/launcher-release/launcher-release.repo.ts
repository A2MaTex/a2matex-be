import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import type {
  CreateLauncherReleaseInputType,
  GetLauncherReleaseDetailOutputType,
  GetLauncherReleaseListInputType,
  GetLauncherReleaseListOutputType,
  UpdateLauncherReleaseInputType,
} from './launcher-release.model.ts';

@Injectable()
export class LauncherReleaseRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  getCurrent() {
    return this.prisma.launcherRelease.findFirst({
      where: {
        isActive: true,
        deletedAt: null,
        static: { deletedAt: null },
      },
      select: {
        id: true,
        version: true,
        releaseNotes: true,
        publishedAt: true,
        staticId: true,
      },
    });
  }

  async getList(query: GetLauncherReleaseListInputType): Promise<GetLauncherReleaseListOutputType> {
    const { page, pageSize, skip, take } = getPagination(query);
    const where = { deletedAt: null };
    const [totalItems, releases] = await Promise.all([
      this.prisma.launcherRelease.count({ where }),
      this.prisma.launcherRelease.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: {
          id: true,
          version: true,
          staticId: true,
          isActive: true,
          publishedAt: true,
          createdAt: true,
          static: {
            select: {
              originalFileName: true,
              size: true,
            },
          },
        },
      }),
    ]);

    return {
      items: releases.map(({ static: staticRecord, ...release }) => ({
        ...release,
        originalFileName: staticRecord.originalFileName,
        size: Number(staticRecord.size),
      })),
      totalItems,
      page,
      pageSize,
      totalPages: Math.ceil(totalItems / pageSize),
    };
  }

  async getById(id: string): Promise<GetLauncherReleaseDetailOutputType | null> {
    const release = await this.prisma.launcherRelease.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      select: {
        id: true,
        version: true,
        staticId: true,
        releaseNotes: true,
        isActive: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
        static: {
          select: {
            id: true,
            originalFileName: true,
            contentType: true,
            size: true,
          },
        },
      },
    });

    if (!release) {
      return null;
    }

    return {
      ...release,
      static: {
        ...release.static,
        size: Number(release.static.size),
      },
    };
  }

  getActivationContext(id: string) {
    return this.prisma.launcherRelease.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      select: {
        id: true,
        isActive: true,
        publishedAt: true,
        static: {
          select: {
            deletedAt: true,
          },
        },
      },
    });
  }

  create(data: CreateLauncherReleaseInputType) {
    return this.prisma.launcherRelease.create({
      data: {
        version: data.version,
        staticId: data.staticId,
        releaseNotes: data.releaseNotes,
        isActive: false,
      },
      select: { id: true },
    });
  }

  update({ id, data }: { id: string; data: UpdateLauncherReleaseInputType }) {
    return this.prisma.launcherRelease.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date(),
      },
      select: { id: true },
    });
  }

  deactivateCurrent({ excludeId, now }: { excludeId: string; now: Date }) {
    return this.prisma.launcherRelease.updateMany({
      where: {
        id: { not: excludeId },
        isActive: true,
        deletedAt: null,
      },
      data: {
        isActive: false,
        updatedAt: now,
      },
    });
  }

  activate({ id, now, publishedAt }: { id: string; now: Date; publishedAt: Date }) {
    return this.prisma.launcherRelease.update({
      where: { id },
      data: {
        isActive: true,
        publishedAt,
        updatedAt: now,
      },
      select: { id: true },
    });
  }
}
