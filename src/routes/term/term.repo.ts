import { Inject, Injectable } from '@nestjs/common';
import type { TermStatusType, TermTypeType } from '../../shared/constants/publisher.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import type {
  CreateTermInputType,
  GetTermListInputType,
  GetTermListOutputType,
  UpdateTermInputType,
} from './term.model.ts';

@Injectable()
export class TermRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  getCurrent(type: TermTypeType) {
    return this.prisma.term.findFirst({
      where: {
        type,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: {
        id: true,
        type: true,
        version: true,
        title: true,
        content: true,
        publishedAt: true,
      },
    });
  }

  async getList(query: GetTermListInputType): Promise<GetTermListOutputType> {
    const { page, limit, skip, take } = getPagination(query);
    const where = {
      type: query.type,
      status: query.status,
      deletedAt: null,
    };
    const [totalItems, terms] = await Promise.all([
      this.prisma.term.count({ where }),
      this.prisma.term.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: {
          id: true,
          type: true,
          version: true,
          title: true,
          status: true,
          publishedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return {
      items: terms,
      totalItems,
      page,
      limit,
      totalPages: Math.ceil(totalItems / limit),
    };
  }

  getById(id: string) {
    return this.prisma.term.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      select: {
        id: true,
        type: true,
        version: true,
        title: true,
        content: true,
        status: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  getStatusContext(id: string) {
    return this.prisma.term.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      select: {
        id: true,
        type: true,
        status: true,
        publishedAt: true,
      },
    });
  }

  create({ data, userId }: { data: CreateTermInputType; userId: string }) {
    return this.prisma.term.create({
      data: {
        ...data,
        status: 'DRAFT',
        createdById: userId,
        updatedById: userId,
      },
      select: {
        id: true,
      },
    });
  }

  updateDraft({ id, data, userId }: { id: string; data: UpdateTermInputType; userId: string }) {
    return this.prisma.term.updateMany({
      where: { id, status: 'DRAFT', deletedAt: null },
      data: {
        ...data,
        updatedAt: new Date(),
        updatedById: userId,
      },
    });
  }

  archiveActiveByType({
    type,
    excludeId,
    userId,
    now,
  }: {
    type: TermTypeType;
    excludeId: string;
    userId: string;
    now: Date;
  }) {
    return this.prisma.term.updateMany({
      where: {
        type,
        status: 'ACTIVE',
        deletedAt: null,
        id: { not: excludeId },
      },
      data: {
        status: 'ARCHIVED',
        updatedAt: now,
        updatedById: userId,
      },
    });
  }

  updateStatus({
    id,
    status,
    userId,
    now,
    publishedAt,
  }: {
    id: string;
    status: TermStatusType;
    userId: string;
    now: Date;
    publishedAt: Date;
  }) {
    return this.prisma.term.update({
      where: { id },
      data: {
        status,
        publishedAt,
        updatedAt: now,
        updatedById: userId,
      },
      select: { id: true },
    });
  }
}
