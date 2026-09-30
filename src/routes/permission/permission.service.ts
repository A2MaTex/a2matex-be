import { Inject, Injectable } from '@nestjs/common';
import { CACHE_PROVIDER } from '../../shared/infrastructure/cache/cache.interface.ts';
import type { CacheProvider } from '../../shared/infrastructure/cache/cache.interface.ts';
import { MessageResType, SUCCESS_RESPONSE } from '../../shared/models/response.model.ts';
import { isNotFoundPrismaError, isUniqueConstraintPrismaError } from '../../shared/utils/prisma.ts';
import { ROLE_PERMISSION_CACHE_PREFIX } from '../../shared/constants/cache.constant.ts';
import { PostProcess, PostProcessContext } from '../../shared/decorators/post-process.decorator.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import { DistributedLock } from '../../shared/decorators/distributed-lock.decorator.ts';
import {
  PermissionAlreadyExistsException,
  PermissionNotFoundException,
} from './permission.error.ts';
import { PermissionRepo } from './permission.repo.ts';
import {
  CreatePermissionInputType,
  DeleteManyPermissionInputType,
  UpdatePermissionInputType,
} from './permission.model.ts';

@Injectable()
export class PermissionService {
  constructor(
    @Inject(PermissionRepo) private readonly permissionRepo: PermissionRepo,
    @Inject(CACHE_PROVIDER) private readonly cacheProvider: CacheProvider,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
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

  getList() {
    return this.permissionRepo.getList();
  }

  async getDetail(id: string) {
    const permission = await this.permissionRepo.getDetail(id);
    if (!permission) {
      throw PermissionNotFoundException;
    }

    return permission;
  }

  @PostProcess({
    handlers: ['removeRolePermissionCache'],
  })
  @DistributedLock({
    useCase: 'update_permission',
    resource: ({ id }: { id: string }) => id,
  })
  @Transactional()
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

      await this.permissionRepo.update({
        id,
        data,
        updatedById,
      });

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

  @DistributedLock({
    useCase: 'delete_permissions',
  })
  async deleteMany({
    data,
    deletedById,
  }: {
    data: DeleteManyPermissionInputType;
    deletedById: string;
  }) {
    const roleIds = await this.permissionRepo.getRoleIdsByPermissionIds(data.ids);
    return this.deletePermissions({
      data,
      deletedById,
      roleIds,
    });
  }

  @PostProcess({
    handlers: ['removeRolePermissionCache'],
  })
  @Transactional()
  private async deletePermissions({
    data,
    deletedById,
  }: {
    data: DeleteManyPermissionInputType;
    deletedById: string;
    roleIds: string[];
  }) {
    await this.permissionRepo.softDeleteRolePermissionsByPermissionIds(data.ids);
    await this.permissionRepo.deleteMany({
      ids: data.ids,
      deletedById,
    });

    return SUCCESS_RESPONSE;
  }

  private async removeRolePermissionCache({
    args,
  }: PostProcessContext<
    MessageResType,
    [{ id: string } | { roleIds: string[] }]
  >) {
    const [payload] = args;
    const roleIds =
      'id' in payload
        ? await this.permissionRepo.getRoleIdsByPermissionIds([payload.id])
        : payload.roleIds;

    if (roleIds.length === 0) {
      return;
    }

    await this.cacheProvider.RemoveStates(ROLE_PERMISSION_CACHE_PREFIX, roleIds);
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
