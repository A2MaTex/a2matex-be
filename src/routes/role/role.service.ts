import { Inject, Injectable } from '@nestjs/common';
import { RoleName } from '../../shared/constants/role.constant.ts';
import { CACHE_PROVIDER } from '../../shared/infrastructure/cache/cache.interface.ts';
import type { CacheProvider } from '../../shared/infrastructure/cache/cache.interface.ts';
import { ROLE_PERMISSION_CACHE_PREFIX } from '../../shared/constants/auth.constant.ts';
import { MessageResType, SUCCESS_RESPONSE } from '../../shared/models/response.model.ts';
import { isNotFoundPrismaError, isUniqueConstraintPrismaError } from '../../shared/utils/prisma.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import {
  PostProcess,
  PostProcessContext,
} from '../../shared/decorators/post-process.decorator.ts';
import {
  CreateRoleInputType,
  DeleteManyRoleInputType,
  GetRoleListInputType,
  UpdateRoleInputType,
  UpdateRolePermissionsInputType,
} from './role.model.ts';
import {
  PermissionNotFoundForRoleException,
  ProhibitedActionOnBaseRoleException,
  RoleAlreadyExistsException,
  RoleNotFoundException,
} from './role.error.ts';
import { RoleRepo } from './role.repo.ts';

const BASE_ROLE_NAMES = [RoleName.Admin, RoleName.Customer, RoleName.Publisher] as string[];

@Injectable()
export class RoleService {
  constructor(
    @Inject(RoleRepo) private readonly roleRepo: RoleRepo,
    @Inject(CACHE_PROVIDER) private readonly cacheProvider: CacheProvider,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
  ) {}

  async create({ data, createdById }: { data: CreateRoleInputType; createdById: string }) {
    try {
      await this.validateRoleNameIsUnique({
        name: data.name,
      });

      return await this.roleRepo.create({
        data,
        createdById,
      });
    } catch (error) {
      if (isUniqueConstraintPrismaError(error)) {
        throw RoleAlreadyExistsException;
      }
      throw error;
    }
  }

  getList(query: GetRoleListInputType) {
    return this.roleRepo.getList(query);
  }

  async getDetail(id: string) {
    const role = await this.roleRepo.getDetail(id);
    if (!role) {
      throw RoleNotFoundException;
    }

    return role;
  }

  @PostProcess({
    handlers: ['removeRolePermissionCache'],
  })
  async update({
    id,
    data,
    updatedById,
  }: {
    id: string;
    data: UpdateRoleInputType;
    updatedById: string;
  }) {
    try {
      const currentRole = await this.getDetail(id);
      this.validateBaseRoleCanBeChanged(currentRole.name);

      await this.validateRoleNameIsUnique({
        name: data.name ?? currentRole.name,
        excludeId: id,
      });

      await this.roleRepo.update({
        id,
        data,
        updatedById,
      });

      return SUCCESS_RESPONSE;
    } catch (error) {
      if (isNotFoundPrismaError(error)) {
        throw RoleNotFoundException;
      }
      if (isUniqueConstraintPrismaError(error)) {
        throw RoleAlreadyExistsException;
      }
      throw error;
    }
  }

  @PostProcess({
    handlers: ['removeRolePermissionCache'],
  })
  @Transactional()
  async deleteMany({ data, deletedById }: { data: DeleteManyRoleInputType; deletedById: string }) {
    const roles = await this.roleRepo.getActiveRolesByIds(data.ids);
    if (roles.length !== new Set(data.ids).size) {
      throw RoleNotFoundException;
    }

    roles.forEach((role) => this.validateBaseRoleCanBeChanged(role.name));

    await this.roleRepo.softDeleteRolePermissionsByRoleIds(data.ids);
    await this.roleRepo.softDeleteUserRolesByRoleIds(data.ids);
    await this.roleRepo.deleteMany({
      ids: data.ids,
      deletedById,
    });

    return SUCCESS_RESPONSE;
  }

  async getPermissions(id: string) {
    await this.validateRoleExists(id);
    const permissionIds = await this.roleRepo.getPermissionIds(id);

    return {
      items: permissionIds,
    };
  }

  @PostProcess({
    handlers: ['removeRolePermissionCache'],
  })
  @Transactional()
  async updatePermissions({ id, data }: { id: string; data: UpdateRolePermissionsInputType }) {
    const role = await this.validateRoleExists(id);
    this.validateBaseRoleCanBeChanged(role.name);

    await this.validatePermissionsAreActive(data.permissionIds);
    await this.roleRepo.syncRolePermissions({
      roleId: id,
      permissionIds: data.permissionIds,
    });

    return SUCCESS_RESPONSE;
  }

  private async validateRoleNameIsUnique({
    name,
    excludeId,
  }: {
    name: string;
    excludeId?: string;
  }) {
    const isDuplicated = await this.roleRepo.existsByName({
      name,
      excludeId,
    });
    if (isDuplicated) {
      throw RoleAlreadyExistsException;
    }
  }

  private async validateRoleExists(id: string) {
    const roles = await this.roleRepo.getActiveRolesByIds([id]);
    const [role] = roles;
    if (!role) {
      throw RoleNotFoundException;
    }

    return role;
  }

  private async validatePermissionsAreActive(permissionIds?: string[]) {
    if (!permissionIds) {
      return;
    }

    const uniquePermissionIds = [...new Set(permissionIds)];
    const activePermissionCount = await this.roleRepo.countActivePermissions(uniquePermissionIds);
    if (activePermissionCount !== uniquePermissionIds.length) {
      throw PermissionNotFoundForRoleException;
    }
  }

  private validateBaseRoleCanBeChanged(roleName: string) {
    if (BASE_ROLE_NAMES.includes(roleName)) {
      throw ProhibitedActionOnBaseRoleException;
    }
  }

  private async removeRolePermissionCache({
    args,
  }: PostProcessContext<
    MessageResType,
    [{ id: string } | { data: DeleteManyRoleInputType }]
  >) {
    const [payload] = args;
    const roleIds = 'id' in payload ? [payload.id] : payload.data.ids;

    if (roleIds.length === 0) {
      return;
    }

    await this.cacheProvider.RemoveStates(ROLE_PERMISSION_CACHE_PREFIX, roleIds);
  }
}
