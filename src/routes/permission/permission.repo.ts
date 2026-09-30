import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import {
  CreatePermissionInputType,
  GetPermissionListOutputType,
  PermissionOutputType,
  UpdatePermissionInputType,
} from './permission.model.ts';

@Injectable()
export class PermissionRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  async getList(): Promise<GetPermissionListOutputType> {
    const where = {
      deletedAt: null,
    };

    const [totalItems, data] = await Promise.all([
      this.prisma.permission.count({
        where,
      }),
      this.prisma.permission.findMany({
        where,
        orderBy: {
          module: 'asc',
        },
      }),
    ]);

    return {
      items: data as PermissionOutputType[],
      totalItems,
    };
  }

  async getDetail(id: string): Promise<PermissionOutputType | null> {
    const permission = await this.prisma.permission.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    return permission as PermissionOutputType | null;
  }

  async create({ data, createdById }: { data: CreatePermissionInputType; createdById: string }) {
    return this.prisma.permission.create({
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
    const permission = await this.prisma.permission.findFirst({
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
    return this.prisma.permission.update({
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
    return this.prisma.permission.updateMany({
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
    const rolePermissions = await this.prisma.rolePermission.findMany({
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
    return this.prisma.rolePermission.updateMany({
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
