import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { RoleName, HTTPMethod } from '../shared/constants/role.constant.ts';
import { API_PREFIX_PATH } from '../shared/constants/system.constant.ts';
import { PrismaService } from '../shared/services/prisma.service.ts';
import envConfig from '../shared/config.ts';
import { ROLE_PERMISSION_CACHE_PREFIX } from '../shared/constants/cache.constant.ts';
import { RedisCacheProvider } from '../shared/infrastructure/cache/redis/redis-cache.provider.ts';
import type { Permission } from '../generated/prisma/client.ts';

type AvailableRoute = {
  path: string;
  method: keyof typeof HTTPMethod;
  name: string;
  module: string;
};

const excludedPermissionModules = new Set(['HEALTH', 'ROOT']);

const routeDecoratorMethodMap: Record<string, keyof typeof HTTPMethod> = {
  Get: HTTPMethod.GET,
  Post: HTTPMethod.POST,
  Put: HTTPMethod.PUT,
  Delete: HTTPMethod.DELETE,
  Patch: HTTPMethod.PATCH,
  Options: HTTPMethod.OPTIONS,
  Head: HTTPMethod.HEAD,
};
const currentFilePath = fileURLToPath(import.meta.url);
const sourceRoot = path.resolve(path.dirname(currentFilePath), '..');

function normalizePath(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (normalizedPath === API_PREFIX_PATH || normalizedPath.startsWith(`${API_PREFIX_PATH}/`)) {
    return normalizedPath;
  }
  return `${API_PREFIX_PATH}${normalizedPath}`;
}

function getModuleName(path: string) {
  const pathWithoutPrefix = path === API_PREFIX_PATH ? '/' : path.slice(API_PREFIX_PATH.length);
  const [moduleName] = pathWithoutPrefix.split('/').filter(Boolean);
  return (moduleName ?? 'ROOT').toUpperCase();
}

function buildPermissionKey(permission: Pick<Permission, 'method' | 'path'>) {
  return `${permission.method}_${permission.path}`;
}

function getDecoratorCall(decorator: ts.Decorator) {
  const expression = decorator.expression;
  return ts.isCallExpression(expression) ? expression : null;
}

function getDecoratorName(decorator: ts.Decorator) {
  const callExpression = getDecoratorCall(decorator);
  const expression = callExpression?.expression;
  return expression && ts.isIdentifier(expression) ? expression.text : null;
}

function getDecoratorPath(decorator: ts.Decorator) {
  const callExpression = getDecoratorCall(decorator);
  const [firstArgument] = callExpression?.arguments ?? [];
  if (
    firstArgument &&
    (ts.isStringLiteral(firstArgument) || ts.isNoSubstitutionTemplateLiteral(firstArgument))
  ) {
    return firstArgument.text;
  }
  return '';
}

function joinRoutePath(controllerPath: string, methodPath: string) {
  return [controllerPath, methodPath]
    .map((item) => item.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

function getControllerFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return getControllerFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith('controller.ts') ? [entryPath] : [];
  });
}

function getRoutesFromControllerFile(filePath: string) {
  const sourceFile = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const routes: AvailableRoute[] = [];

  sourceFile.forEachChild((node) => {
    if (!ts.isClassDeclaration(node)) {
      return;
    }

    const classDecorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
    const controllerDecorator = classDecorators?.find((decorator) => {
      return getDecoratorName(decorator) === 'Controller';
    });
    if (!controllerDecorator) {
      return;
    }

    const controllerPath = getDecoratorPath(controllerDecorator);
    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member)) {
        continue;
      }

      const methodDecorators = ts.canHaveDecorators(member) ? ts.getDecorators(member) : undefined;
      const routeDecorator = methodDecorators?.find((decorator) => {
        const decoratorName = getDecoratorName(decorator);
        return decoratorName ? routeDecoratorMethodMap[decoratorName] : false;
      });
      if (!routeDecorator) {
        continue;
      }

      const decoratorName = getDecoratorName(routeDecorator);
      if (!decoratorName) {
        continue;
      }

      const method = routeDecoratorMethodMap[decoratorName];
      const path = normalizePath(joinRoutePath(controllerPath, getDecoratorPath(routeDecorator)));
      routes.push({
        path,
        method,
        name: `${method} ${path}`,
        module: getModuleName(path),
      });
    }
  });

  return routes;
}

function getRoutes() {
  const routeMap = new Map<string, AvailableRoute>();
  for (const controllerFile of getControllerFiles(sourceRoot)) {
    for (const route of getRoutesFromControllerFile(controllerFile)) {
      if (excludedPermissionModules.has(route.module)) {
        continue;
      }

      routeMap.set(buildPermissionKey(route), route);
    }
  }
  return [...routeMap.values()];
}

async function getAdminSeedContext(prisma: PrismaService) {
  const adminRole = await prisma.role.findFirstOrThrow({
    where: {
      name: RoleName.Admin,
      deletedAt: null,
    },
  });

  const adminUserRole = await prisma.userRole.findFirstOrThrow({
    where: {
      roleId: adminRole.id,
      deletedAt: null,
      user: {
        deletedAt: null,
      },
    },
    select: {
      userId: true,
    },
  });

  return {
    adminRoleId: adminRole.id,
    auditUserId: adminUserRole.userId,
  };
}

async function syncPermissions(
  prisma: PrismaService,
  routes: AvailableRoute[],
  auditUserId: string,
) {
  const permissionsInDb = await prisma.permission.findMany({
    where: {
      deletedAt: null,
    },
  });
  const permissionsInDbMap = permissionsInDb.reduce<Record<string, Permission>>((result, item) => {
    result[buildPermissionKey(item)] = item;
    return result;
  }, {});
  const availableRoutesMap = routes.reduce<Record<string, AvailableRoute>>((result, item) => {
    result[buildPermissionKey(item)] = item;
    return result;
  }, {});

  const now = new Date();
  const permissionsToDelete = permissionsInDb.filter((item) => {
    return !availableRoutesMap[buildPermissionKey(item)];
  });
  if (permissionsToDelete.length > 0) {
    const permissionIds = permissionsToDelete.map((item) => item.id);

    await prisma.rolePermission.updateMany({
      where: {
        permissionId: {
          in: permissionIds,
        },
        deletedAt: null,
      },
      data: {
        deletedAt: now,
      },
    });

    const deleteResult = await prisma.permission.updateMany({
      where: {
        id: {
          in: permissionIds,
        },
        deletedAt: null,
      },
      data: {
        deletedAt: now,
        deletedById: auditUserId,
      },
    });
    console.log('Deleted permissions:', deleteResult.count);
  } else {
    console.log('No permissions to delete');
  }

  const routesToAdd = routes.filter((item) => {
    return !permissionsInDbMap[buildPermissionKey(item)];
  });
  if (routesToAdd.length > 0) {
    const permissionsToAdd = await prisma.permission.createMany({
      data: routesToAdd.map((route) => ({
        ...route,
        description: route.name,
        createdById: auditUserId,
        updatedById: auditUserId,
      })),
    });
    console.log('Added permissions:', permissionsToAdd.count);
  } else {
    console.log('No permissions to add');
  }
}

async function syncAdminPermissions(prisma: PrismaService, adminRoleId: string) {
  const permissions = await prisma.permission.findMany({
    where: {
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });
  const permissionIds = permissions.map((permission) => permission.id);

  await prisma.rolePermission.updateMany({
    where: {
      roleId: adminRoleId,
      deletedAt: null,
      permissionId: {
        notIn: permissionIds,
      },
    },
    data: {
      deletedAt: new Date(),
    },
  });

  const result = await prisma.rolePermission.createMany({
    data: permissionIds.map((permissionId) => ({
      roleId: adminRoleId,
      permissionId,
    })),
    skipDuplicates: true,
  });
  console.log('Assigned permissions to admin role:', result.count);
}

/**
 * The access-token guard caches each role's permissions in Redis with no expiry,
 * so rows written straight to the database here stay invisible until the cache is
 * dropped. Without this, every deploy that adds a route answers 403 for everyone.
 */
async function clearRolePermissionCache() {
  const cache = new RedisCacheProvider({
    host: envConfig.REDIS_HOST,
    port: envConfig.REDIS_PORT,
    password: envConfig.REDIS_PASSWORD,
    keyPrefix: `${envConfig.REDIS_PREFIX}${envConfig.NODE_ENV}:`,
  });

  try {
    await cache.Connect();
    await cache.RemoveStatesWithPattern(ROLE_PERMISSION_CACHE_PREFIX, '*');
    console.log('Cleared role permission cache');
  } catch (error) {
    // The database is already correct; a cache that cannot be reached is the
    // operator's problem to fix, but it must not fail the seed.
    console.warn(
      `Could not clear the role permission cache, clear it manually: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    await cache.Disconnect().catch(() => undefined);
  }
}

async function bootstrap() {
  const prisma = new PrismaService();

  try {
    const routes = getRoutes();
    const { adminRoleId, auditUserId } = await getAdminSeedContext(prisma);

    await syncPermissions(prisma, routes, auditUserId);
    await syncAdminPermissions(prisma, adminRoleId);
    await clearRolePermissionCache();
  } finally {
    await prisma.$disconnect();
  }
}

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
