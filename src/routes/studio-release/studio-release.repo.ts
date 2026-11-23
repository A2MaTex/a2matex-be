import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import type {
  CreateStudioReleaseInputType,
  GetStudioReleaseDetailOutputType,
  GetStudioReleaseListInputType,
  GetStudioReleaseListOutputType,
  UpdateStudioReleaseInputType,
} from './studio-release.model.ts';

@Injectable()
export class StudioReleaseRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  getCurrent() {
    return this.prisma.studioRelease.findFirst({
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

  // Không lọc theo static.deletedAt: Admin phải thấy được bản có tệp đã xoá để xử lý.
  async getList(query: GetStudioReleaseListInputType): Promise<GetStudioReleaseListOutputType> {
    const { page, pageSize, skip, take } = getPagination(query);
    const where = { deletedAt: null };
    const [totalItems, releases] = await Promise.all([
      this.prisma.studioRelease.count({ where }),
      this.prisma.studioRelease.findMany({
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

  async getById(id: string): Promise<GetStudioReleaseDetailOutputType | null> {
    const release = await this.prisma.studioRelease.findFirst({
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

  getEditContext(id: string) {
    return this.prisma.studioRelease.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      select: {
        id: true,
        isActive: true,
      },
    });
  }

  getActivationContext(id: string) {
    return this.prisma.studioRelease.findFirst({
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

  create(data: CreateStudioReleaseInputType) {
    return this.prisma.studioRelease.create({
      data: {
        version: data.version,
        staticId: data.staticId,
        releaseNotes: data.releaseNotes,
        isActive: false,
      },
      select: { id: true },
    });
  }

  update({ id, data }: { id: string; data: UpdateStudioReleaseInputType }) {
    return this.prisma.studioRelease.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date(),
      },
      select: { id: true },
    });
  }

  deactivateCurrent({ excludeId, now }: { excludeId: string; now: Date }) {
    return this.prisma.studioRelease.updateMany({
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
    return this.prisma.studioRelease.update({
      where: { id },
      data: {
        isActive: true,
        publishedAt,
        updatedAt: now,
      },
      select: { id: true },
    });
  }

  // Giữ nguyên publishedAt: đó là mốc lần đầu công bố, không phải mốc đang hiệu lực.
  deactivate({ id, now }: { id: string; now: Date }) {
    return this.prisma.studioRelease.update({
      where: { id },
      data: {
        isActive: false,
        updatedAt: now,
      },
      select: { id: true },
    });
  }
}
