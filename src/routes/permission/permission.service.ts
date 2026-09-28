import { Inject, Injectable } from '@nestjs/common';
import { CACHE_PROVIDER } from '../../shared/infrastructure/cache/cache.interface.ts';
import type { CacheProvider } from '../../shared/infrastructure/cache/cache.interface.ts';
import { SUCCESS_RESPONSE } from '../../shared/models/response.model.ts';
import { isNotFoundPrismaError, isUniqueConstraintPrismaError } from '../../shared/utils/prisma.ts';
import { PermissionAlreadyExistsException, PermissionNotFoundException } from './permission.error.ts';
import { PermissionRepo } from './permission.repo.ts';
import {
  CreatePermissionInputType,
  DeleteManyPermissionInputType,
  GetPermissionListInputType,
  UpdatePermissionInputType,
} from './permission.model.ts';

@Injectable()
export class PermissionService {
  constructor(
    @Inject(PermissionRepo) private readonly permissionRepo: PermissionRepo,
    @Inject(CACHE_PROVIDER) private readonly cacheProvider: CacheProvider,
  ) {}

  async create({ data, createdById }: { data: CreatePermissionInputType; createdById: string }) {
    try {
      await this.validatePermissionIsUnique({
        method: data.method,
        path: data.path,
      });

      return await this.permissionRepo.create({
        data,
        createdById,
      });
    } catch (error) {
      if (isUniqueConstraintPrismaError(error)) {
        throw PermissionAlreadyExistsException;
      }
      throw error;
    }
  }

  getList(query: GetPermissionListInputType) {
    return this.permissionRepo.getList(query);
  }

  async getDetail(id: string) {
    const permission = await this.permissionRepo.getDetail(id);
    if (!permission) {
      throw PermissionNotFoundException;
    }

    return permission;
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
    try {
      const currentPermission = await this.getDetail(id);
      await this.validatePermissionIsUnique({
        method: data.method ?? currentPermission.method,
        path: data.path ?? currentPermission.path,
        excludeId: id,
      });

      const roleIds = await this.permissionRepo.getRoleIdsByPermissionIds([id]);
      await this.permissionRepo.update({
        id,
        data,
        updatedById,
      });
      await this.removeRolePermissionCache(roleIds);

      return SUCCESS_RESPONSE;
    } catch (error) {
      if (isNotFoundPrismaError(error)) {
        throw PermissionNotFoundException;
      }
      if (isUniqueConstraintPrismaError(error)) {
        throw PermissionAlreadyExistsException;
      }
      throw error;
    }
  }

  async deleteMany({
    data,
    deletedById,
  }: {
    data: DeleteManyPermissionInputType;
    deletedById: string;
  }) {
    const roleIds = await this.permissionRepo.getRoleIdsByPermissionIds(data.ids);
    await this.permissionRepo.softDeleteRolePermissionsByPermissionIds(data.ids);
    await this.permissionRepo.deleteMany({
      ids: data.ids,
      deletedById,
    });
    await this.removeRolePermissionCache(roleIds);

    return SUCCESS_RESPONSE;
  }

  private async removeRolePermissionCache(roleIds: string[]) {
    if (roleIds.length === 0) {
      return;
    }

    await this.cacheProvider.RemoveStates('role_permissions:', roleIds);
  }

  private async validatePermissionIsUnique({
    method,
    path,
    excludeId,
  }: {
    method: CreatePermissionInputType['method'];
    path: string;
    excludeId?: string;
  }) {
    const isDuplicated = await this.permissionRepo.existsByMethodPath({
      method,
      path,
      excludeId,
    });
    if (isDuplicated) {
      throw PermissionAlreadyExistsException;
    }
  }
}
