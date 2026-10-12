import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { CACHE_PROVIDER } from '../infrastructure/cache/cache.interface.ts';
import type { CacheProvider } from '../infrastructure/cache/cache.interface.ts';
import {
  AccountBlockedException,
  UnauthorizedAccessException,
} from '../../routes/auth/auth.error.js';
import { SKIP_PERMISSION_CHECK_KEY } from '../decorators/auth.decorator.ts';
import {
  REQUEST_ROLE_PERMISSIONS,
  REQUEST_USER_KEY,
  RoleStatus,
  UserStatus,
} from '../constants/auth.constant.js';
import { ROLE_PERMISSION_CACHE_PREFIX } from '../constants/cache.constant.ts';
import { PermissionScope } from '../constants/role.constant.ts';
import { API_PREFIX_PATH } from '../constants/system.constant.js';
import { PrismaService } from '../services/prisma.service.ts';
import { TokenService } from '../services/token.service.ts';
import type { AccessTokenPayload } from '../types/jwt.type.js';
import type {
  PermissionGrant,
  RolePermissionCacheValue,
  RolePermissionPayload,
} from '../types/role-permission.type.ts';

const VALID_PERMISSION_SCOPES = new Set<string>(Object.values(PermissionScope));

type AuthRequest = Request & {
  route?: {
    path?: string;
  };
  [REQUEST_USER_KEY]?: AccessTokenPayload;
  [REQUEST_ROLE_PERMISSIONS]?: RolePermissionPayload;
};

@Injectable()
/**
 * Validates the Bearer access token, active user session, active device, and
 * merged permissions from all active user roles before allowing a protected API request.
 */
export class AccessTokenGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokenService) private readonly tokenService: TokenService,
    @Inject(PrismaService) private readonly prismaService: PrismaService,
    @Inject(CACHE_PROVIDER) private readonly cacheProvider: CacheProvider,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const decodedAccessToken = await this.extractAndValidateToken(request);

    const roleIds = await this.validateUserSession(decodedAccessToken);
    if (this.shouldSkipPermissionCheck(context)) {
      return true;
    }

    await this.validateUserPermission(roleIds, request);
    return true;
  }

  private shouldSkipPermissionCheck(context: ExecutionContext) {
    return (
      this.reflector.getAllAndOverride<boolean | undefined>(SKIP_PERMISSION_CHECK_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false
    );
  }

  private async validateUserSession({ userId, deviceId }: AccessTokenPayload): Promise<string[]> {
    const user = await this.prismaService.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
        userRoles: {
          some: {
            deletedAt: null,
            role: {
              status: RoleStatus.ACTIVE,
              deletedAt: null,
            },
          },
        },
      },
      select: {
        status: true,
        userRoles: {
          where: {
            deletedAt: null,
            role: {
              status: RoleStatus.ACTIVE,
              deletedAt: null,
            },
          },
          select: {
            roleId: true,
          },
        },
      },
    });
    if (!user) {
      throw UnauthorizedAccessException;
    }
    if (user.status === UserStatus.BANNED) {
      throw AccountBlockedException;
    }

    const device = await this.prismaService.device.findFirst({
      where: {
        id: deviceId,
        userId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });
    if (!device) {
      throw UnauthorizedAccessException;
    }

    return user.userRoles.map(({ roleId }) => roleId);
  }

  private async extractAndValidateToken(request: AuthRequest): Promise<AccessTokenPayload> {
    const accessToken = this.extractAccessTokenFromHeader(request);
    try {
      const decodedAccessToken = await this.tokenService.verifyAccessToken(accessToken);

      request[REQUEST_USER_KEY] = decodedAccessToken;
      return decodedAccessToken;
    } catch {
      throw new UnauthorizedException('Error.InvalidAccessToken');
    }
  }

  private extractAccessTokenFromHeader(request: AuthRequest): string {
    const [type, accessToken] = request.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !accessToken) {
      throw new UnauthorizedException('Error.MissingAccessToken');
    }
    return accessToken;
  }

  private async validateUserPermission(roleIds: string[], request: AuthRequest): Promise<void> {
    const routeKey = this.buildPermissionKey(request.method, this.getRequestPath(request));
    const rolePermissions = await this.getRolePermissions(roleIds, routeKey);
    if (rolePermissions.grants.length === 0) {
      throw new ForbiddenException();
    }

    request[REQUEST_ROLE_PERMISSIONS] = rolePermissions;
  }

  private async getRolePermissions(
    roleIds: string[],
    routeKey: string,
  ): Promise<RolePermissionPayload> {
    const uniqueRoleIds = [...new Set(roleIds)];
    const cachedValues = await this.cacheProvider.GetStateObjects<unknown>(
      ROLE_PERMISSION_CACHE_PREFIX,
      uniqueRoleIds,
    );
    const permissionsByRoleId: Record<string, RolePermissionCacheValue> = {};

    for (const roleId of uniqueRoleIds) {
      const cachedValue = cachedValues[roleId];
      if (this.isRolePermissionCacheValue(cachedValue)) {
        permissionsByRoleId[roleId] = cachedValue;
      }
    }

    const missingRoleIds = uniqueRoleIds.filter(
      (roleId) => !Object.hasOwn(permissionsByRoleId, roleId),
    );

    if (missingRoleIds.length > 0) {
      const roles = await this.prismaService.role.findMany({
        where: {
          id: {
            in: missingRoleIds,
          },
          deletedAt: null,
          status: RoleStatus.ACTIVE,
        },
        select: {
          id: true,
          name: true,
          rolePermissions: {
            where: {
              deletedAt: null,
              permission: {
                deletedAt: null,
              },
            },
            select: {
              permission: {
                select: {
                  id: true,
                  path: true,
                  method: true,
                  scope: true,
                },
              },
            },
          },
        },
      });
      if (roles.length !== missingRoleIds.length) {
        throw new ForbiddenException();
      }

      await Promise.all(
        roles.map(async (role) => {
          const routes = role.rolePermissions.reduce<Record<string, PermissionGrant[]>>(
            (result, { permission }) => {
              const permissionKey = this.buildPermissionKey(permission.method, permission.path);
              const grants = (result[permissionKey] ??= []);
              grants.push({
                permissionId: permission.id,
                scope: permission.scope,
              });
              return result;
            },
            {},
          );
          const cacheValue: RolePermissionCacheValue = {
            roleName: role.name,
            routes,
          };
          permissionsByRoleId[role.id] = cacheValue;
          await this.cacheProvider.SetStateObject(
            ROLE_PERMISSION_CACHE_PREFIX,
            role.id,
            cacheValue,
          );
        }),
      );
    }

    const grants = new Map(
      uniqueRoleIds
        .flatMap((roleId) => permissionsByRoleId[roleId].routes[routeKey] ?? [])
        .map((grant) => [grant.permissionId, grant]),
    ).values();

    return {
      roleIds: uniqueRoleIds,
      routeKey,
      grants: [...grants],
    };
  }

  private isRolePermissionCacheValue(value: unknown): value is RolePermissionCacheValue {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const cacheValue = value as Partial<RolePermissionCacheValue>;
    if (
      typeof cacheValue.roleName !== 'string' ||
      !cacheValue.routes ||
      typeof cacheValue.routes !== 'object' ||
      Array.isArray(cacheValue.routes)
    ) {
      return false;
    }

    return Object.values(cacheValue.routes).every(
      (grants) =>
        Array.isArray(grants) &&
        grants.every(
          (grant) =>
            !!grant &&
            typeof grant === 'object' &&
            typeof grant.permissionId === 'string' &&
            (grant.scope === null ||
              (typeof grant.scope === 'string' && VALID_PERMISSION_SCOPES.has(grant.scope))),
        ),
    );
  }

  private getRequestPath(request: AuthRequest) {
    return request.route?.path ?? request.path;
  }

  private buildPermissionKey(method: string, path: string) {
    return `${method}_${this.withApiPrefix(path)}`;
  }

  private withApiPrefix(path: string) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    if (normalizedPath === API_PREFIX_PATH || normalizedPath.startsWith(`${API_PREFIX_PATH}/`)) {
      return normalizedPath;
    }

    return `${API_PREFIX_PATH}${normalizedPath}`;
  }
}
