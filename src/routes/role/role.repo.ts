import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import {
  CreateRoleInputType,
  GetRoleListInputType,
  GetRoleListOutputType,
  RoleDetailOutputType,
  UpdateRoleInputType,
} from './role.model.ts';

@Injectable()
export class RoleRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  async getList(query: GetRoleListInputType): Promise<GetRoleListOutputType> {
    const { page, limit, skip, take } = getPagination(query);
    const where = {
      deletedAt: null,
    };

    const [totalItems, data] = await Promise.all([
      this.prisma.role.count({
        where,
      }),
      this.prisma.role.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take,
      }),
    ]);

    return {
      items: data,
      totalItems,
      page,
      limit,
      totalPages: Math.ceil(totalItems / limit),
    };
  }

  async getDetail(id: string): Promise<RoleDetailOutputType | null> {
    const role = await this.prisma.role.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    if (!role) {
      return null;
    }

    return role;
  }

  async getPermissionIds(roleId: string) {
    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: {
        roleId,
        deletedAt: null,
        permission: {
          deletedAt: null,
        },
      },
      select: {
        permissionId: true,
      },
    });

    return rolePermissions.map(({ permissionId }) => permissionId);
  }

  create({ data, createdById }: { data: CreateRoleInputType; createdById: string }) {
    return this.prisma.role.create({
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

  async existsByName({ name, excludeId }: { name: string; excludeId?: string }) {
    const role = await this.prisma.role.findFirst({
      where: {
        name: {
          equals: name,
          mode: 'insensitive',
        },
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

    return Boolean(role);
  }

  async getActiveRolesByIds(ids: string[]) {
    return this.prisma.role.findMany({
      where: {
        id: {
          in: ids,
        },
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
      },
    });
  }

  async countActivePermissions(permissionIds: string[]) {
    if (permissionIds.length === 0) {
      return 0;
    }

    return this.prisma.permission.count({
      where: {
        id: {
          in: permissionIds,
        },
        deletedAt: null,
      },
    });
  }

  async update({
    id,
    data,
    updatedById,
  }: {
    id: string;
    data: UpdateRoleInputType;
    updatedById: string;
  }) {
    await this.prisma.role.update({
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
    return this.prisma.role.updateMany({
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

  async softDeleteRolePermissionsByRoleIds(roleIds: string[]) {
    return this.prisma.rolePermission.updateMany({
      where: {
        roleId: {
          in: roleIds,
        },
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  async softDeleteUserRolesByRoleIds(roleIds: string[]) {
    return this.prisma.userRole.updateMany({
      where: {
        roleId: {
          in: roleIds,
        },
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  async syncRolePermissions({
    roleId,
    permissionIds,
  }: {
    roleId: string;
    permissionIds: string[];
  }) {
    const uniquePermissionIds = [...new Set(permissionIds)];

    await this.prisma.rolePermission.updateMany({
      where: {
        roleId,
        deletedAt: null,
        permissionId: {
          notIn: uniquePermissionIds,
        },
      },
      data: {
        deletedAt: new Date(),
      },
    });

    if (uniquePermissionIds.length === 0) {
      return;
    }

    await this.prisma.rolePermission.createMany({
      data: uniquePermissionIds.map((permissionId) => ({
        roleId,
        permissionId,
      })),
      skipDuplicates: true,
    });
  }
}
