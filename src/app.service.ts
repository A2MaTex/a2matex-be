import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { RoleStatus, ROLE_PERMISSION_CACHE_PREFIX } from './shared/constants/auth.constant.ts';
import { RoleName } from './shared/constants/role.constant.ts';
import { CACHE_PROVIDER } from './shared/infrastructure/cache/cache.interface.ts';
import type { CacheProvider } from './shared/infrastructure/cache/cache.interface.ts';
import { SUCCESS_RESPONSE } from './shared/models/response.model.ts';
import { PrismaService } from './shared/services/prisma.service.ts';

@Injectable()
export class AppService {
  constructor(
    @Inject(PrismaService) private readonly prismaService: PrismaService,
    @Inject(CACHE_PROVIDER) private readonly cacheProvider: CacheProvider,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  async clearPermissionCache(roleId: string) {
    const role = await this.prismaService.role.findFirst({
      where: {
        id: roleId,
        name: RoleName.Admin,
        status: RoleStatus.ACTIVE,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });
    if (!role) {
      throw new ForbiddenException();
    }

    await this.cacheProvider.RemoveStatesWithPattern(ROLE_PERMISSION_CACHE_PREFIX, '*');

    return SUCCESS_RESPONSE;
  }
}
