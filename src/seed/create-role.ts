import '../shared/config.ts';
import { HashingService } from '../shared/services/hashing.service.ts';
import { PrismaService } from '../shared/services/prisma.service.ts';
import { RoleName } from '../shared/constants/role.constant.ts';
import { RoleStatus, UserStatus } from '../shared/constants/auth.constant.ts';

const prisma = new PrismaService();
const hashingService = new HashingService();
const ADMIN_PROFILE_FULL_NAME = 'Admin';

const seedRoles = [
  {
    name: RoleName.Admin,
    description: 'Admin role',
  },
  {
    name: RoleName.Customer,
    description: 'Customer role',
  },
  {
    name: RoleName.Publisher,
    description: 'Publisher role',
  },
];

function getRequiredEnv(key: string) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is required to seed the initial admin user`);
  }
  return value;
}

async function findOrCreateAdminUser() {
  const username = getRequiredEnv('ADMIN_USERNAME');
  const email = getRequiredEnv('ADMIN_EMAIL');
  const password = getRequiredEnv('ADMIN_PASSWORD');
  const hashedPassword = await hashingService.hash(password);

  const existingAdminUser = await prisma.user.findFirst({
    where: {
      email: {
        equals: email,
        mode: 'insensitive',
      },
      deletedAt: null,
    },
  });

  if (existingAdminUser) {
    return prisma.user.update({
      where: {
        id: existingAdminUser.id,
      },
      data: {
        username,
        password: hashedPassword,
        status: UserStatus.ACTIVE,
        updatedAt: new Date(),
      },
    });
  }

  return prisma.user.create({
    data: {
      username,
      email,
      password: hashedPassword,
      status: UserStatus.ACTIVE,
    },
  });
}

async function upsertAdminProfile(adminUser: { id: string; email: string }) {
  const existingProfile = await prisma.profile.findFirst({
    where: {
      userId: adminUser.id,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });

  if (existingProfile) {
    await prisma.profile.update({
      where: {
        id: existingProfile.id,
      },
      data: {
        fullName: ADMIN_PROFILE_FULL_NAME,
        email: adminUser.email,
        updatedById: adminUser.id,
        updatedAt: new Date(),
      },
    });

    return 'updated';
  }

  await prisma.profile.create({
    data: {
      userId: adminUser.id,
      fullName: ADMIN_PROFILE_FULL_NAME,
      email: adminUser.email,
      createdById: adminUser.id,
      updatedById: adminUser.id,
    },
  });

  return 'created';
}

async function upsertRoles(adminUserId: string) {
  let createdRoleCount = 0;
  let updatedRoleCount = 0;

  for (const roleData of seedRoles) {
    const existingRole = await prisma.role.findFirst({
      where: {
        name: roleData.name,
        deletedAt: null,
      },
    });

    if (existingRole) {
      await prisma.role.update({
        where: {
          id: existingRole.id,
        },
        data: {
          description: roleData.description,
          status: RoleStatus.ACTIVE,
          updatedById: adminUserId,
          updatedAt: new Date(),
        },
      });
      updatedRoleCount += 1;
      continue;
    }

    await prisma.role.create({
      data: {
        ...roleData,
        status: RoleStatus.ACTIVE,
        createdById: adminUserId,
        updatedById: adminUserId,
      },
    });
    createdRoleCount += 1;
  }

  return {
    createdRoleCount,
    updatedRoleCount,
  };
}

async function assignAdminRole(adminUserId: string) {
  const adminRole = await prisma.role.findFirstOrThrow({
    where: {
      name: RoleName.Admin,
      deletedAt: null,
    },
  });

  const existingUserRole = await prisma.userRole.findFirst({
    where: {
      userId: adminUserId,
      roleId: adminRole.id,
      deletedAt: null,
    },
  });

  if (existingUserRole) {
    return existingUserRole;
  }

  return prisma.userRole.create({
    data: {
      userId: adminUserId,
      roleId: adminRole.id,
    },
  });
}

async function main() {
  const adminUser = await findOrCreateAdminUser();
  const adminProfileAction = await upsertAdminProfile(adminUser);
  const roleResult = await upsertRoles(adminUser.id);
  await assignAdminRole(adminUser.id);

  return {
    ...roleResult,
    adminUser,
    adminProfileAction,
  };
}

main()
  .then(({ adminUser, adminProfileAction, createdRoleCount, updatedRoleCount }) => {
    console.log(`Created ${createdRoleCount} roles`);
    console.log(`Updated ${updatedRoleCount} roles`);
    console.log(`Seeded admin user: ${adminUser.email}`);
    console.log(`Admin profile ${adminProfileAction}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
