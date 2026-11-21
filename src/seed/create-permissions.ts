import { RoleName } from '../shared/constants/role.constant.ts';
import { PrismaService } from '../shared/services/prisma.service.ts';
import { buildPermissionKey, getRoutes } from './available-routes.ts';
import type { AvailableRoute } from './available-routes.ts';
import { clearRolePermissionCache } from './clear-role-permission-cache.ts';
import type { Permission } from '../generated/prisma/client.ts';

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
      scope: null,
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
        name: route.name,
        module: route.module,
        path: route.path,
        method: route.method,
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
      scope: null,
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
      permission: {
        scope: null,
      },
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
