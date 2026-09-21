import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import {
  CreatePermissionInputType,
  GetPermissionListInputType,
  GetPermissionListOutputType,
  PermissionOutputType,
  UpdatePermissionInputType,
} from './permission.model.ts';

@Injectable()
export class PermissionRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  async getList(query: GetPermissionListInputType): Promise<GetPermissionListOutputType> {
    const skip = (query.page - 1) * query.limit;
    const take = query.limit;
    const where = {
      deletedAt: null,
    };

    const [totalItems, data] = await Promise.all([
      this.prismaService.permission.count({
        where,
      }),
      this.prismaService.permission.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take,
      }),
    ]);

    return {
      data: data as PermissionOutputType[],
      totalItems,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(totalItems / query.limit),
    };
  }

  async getDetail(id: string): Promise<PermissionOutputType | null> {
    const permission = await this.prismaService.permission.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    return permission as PermissionOutputType | null;
  }

  async create({
    data,
    createdById,
  }: {
    data: CreatePermissionInputType;
    createdById: string;
  }) {
    return this.prismaService.permission.create({
      data: {
        ...data,
        createdById,
        updatedById: createdById,
      },
      select: {
        id: true,
      },
    });
  }

  async existsByMethodPath({
    method,
    path,
    excludeId,
  }: {
    method: CreatePermissionInputType['method'];
    path: string;
    excludeId?: string;
  }) {
    const permission = await this.prismaService.permission.findFirst({
      where: {
        method,
        path,
        deletedAt: null,
        id: excludeId
          ? {
              not: excludeId,
            }
          : undefined,
      },
      select: {
        id: true,
      },
    });

    return Boolean(permission);
  }

  async update({
    id,
    data,
    updatedById,
  }: {
    id: string;
    data: UpdatePermissionInputType;
    updatedById: string;
  }) {
    return this.prismaService.permission.update({
      where: {
        id,
        deletedAt: null,
      },
      data: {
        ...data,
        updatedById,
        updatedAt: new Date(),
      },
      select: {
        id: true,
      },
    });
  }

  async deleteMany({ ids, deletedById }: { ids: string[]; deletedById: string }) {
    return this.prismaService.permission.updateMany({
      where: {
        id: {
          in: ids,
        },
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
        deletedById,
      },
    });
  }

  async getRoleIdsByPermissionIds(permissionIds: string[]) {
    const rolePermissions = await this.prismaService.rolePermission.findMany({
      where: {
        permissionId: {
          in: permissionIds,
        },
        deletedAt: null,
      },
      select: {
        roleId: true,
      },
      distinct: ['roleId'],
    });

    return rolePermissions.map((rolePermission) => rolePermission.roleId);
  }

  async softDeleteRolePermissionsByPermissionIds(permissionIds: string[]) {
    return this.prismaService.rolePermission.updateMany({
      where: {
        permissionId: {
          in: permissionIds,
        },
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }
}
