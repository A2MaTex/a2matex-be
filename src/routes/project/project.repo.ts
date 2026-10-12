import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import { ProjectStatus } from '../../shared/constants/project.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import type {
  CreateProjectInputType,
  GetProjectListInputType,
  GetProjectListOutputType,
  ProjectOutputType,
  UpdateProjectInputType,
} from './project.model.ts';

export type ProjectAccess =
  { unrestricted: true } | { unrestricted: false; publisherAccountId: string };

const PROJECT_SELECT = {
  id: true,
  publisherAccountId: true,
  name: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectSelect;

@Injectable()
export class ProjectRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  getPublisherAccount(userId: string) {
    return this.prisma.publisherAccount.findFirst({
      where: {
        userId,
        deletedAt: null,
      },
      select: {
        id: true,
        status: true,
      },
    });
  }

  create({
    data,
    publisherAccountId,
    userId,
  }: {
    data: CreateProjectInputType;
    publisherAccountId: string;
    userId: string;
  }) {
    return this.prisma.project.create({
      data: {
        ...data,
        publisherAccountId,
        status: ProjectStatus.ACTIVE,
        createdById: userId,
      },
      select: PROJECT_SELECT,
    });
  }

  async getList({
    query,
    access,
  }: {
    query: GetProjectListInputType;
    access: ProjectAccess;
  }): Promise<GetProjectListOutputType> {
    const { page, limit, skip, take } = getPagination(query);
    const where = this.buildAccessWhere(access, query.status);
    const accessSql = access.unrestricted
      ? Prisma.sql``
      : Prisma.sql`AND "publisherAccountId" = ${access.publisherAccountId}::uuid`;

    const [totalItems, projects] = await Promise.all([
      this.prisma.project.count({ where }),
      this.prisma.$queryRaw<ProjectOutputType[]>(Prisma.sql`
        SELECT
          id,
          "publisherAccountId",
          name,
          description,
          status,
          "createdAt",
          "updatedAt"
        FROM "Project"
        WHERE "deletedAt" IS NULL
          AND status = ${query.status}::"ProjectStatus"
          ${accessSql}
        ORDER BY COALESCE("updatedAt", "createdAt") DESC, id DESC
        LIMIT ${take}
        OFFSET ${skip}
      `),
    ]);

    return {
      items: projects,
      totalItems,
      page,
      limit,
      totalPages: Math.ceil(totalItems / limit),
    };
  }

  getById({ id, access }: { id: string; access: ProjectAccess }) {
    return this.prisma.project.findFirst({
      where: {
        id,
        ...this.buildAccessWhere(access),
      },
      select: PROJECT_SELECT,
    });
  }

  async updateActive({
    id,
    data,
    access,
    userId,
  }: {
    id: string;
    data: UpdateProjectInputType;
    access: ProjectAccess;
    userId: string;
  }) {
    const projects = await this.prisma.project.updateManyAndReturn({
      where: {
        id,
        ...this.buildAccessWhere(access, ProjectStatus.ACTIVE),
      },
      data: {
        ...data,
        updatedById: userId,
        updatedAt: new Date(),
      },
      select: PROJECT_SELECT,
    });

    return projects[0] ?? null;
  }

  async archiveActive({
    id,
    access,
    userId,
  }: {
    id: string;
    access: ProjectAccess;
    userId: string;
  }) {
    const projects = await this.prisma.project.updateManyAndReturn({
      where: {
        id,
        ...this.buildAccessWhere(access, ProjectStatus.ACTIVE),
      },
      data: {
        status: ProjectStatus.ARCHIVED,
        updatedById: userId,
        updatedAt: new Date(),
      },
      select: PROJECT_SELECT,
    });

    return projects[0] ?? null;
  }

  private buildAccessWhere(
    access: ProjectAccess,
    status?: GetProjectListInputType['status'],
  ): Prisma.ProjectWhereInput {
    return {
      deletedAt: null,
      status,
      ...(access.unrestricted ? {} : { publisherAccountId: access.publisherAccountId }),
    };
  }
}
