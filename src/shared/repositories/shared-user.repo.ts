import { Inject, Injectable } from '@nestjs/common';
import { PermissionType } from '../../entities/permission.model.ts';
import { RoleType } from '../../entities/role.schema.ts';
import { UserType } from '../../entities/user.model.ts';
import { PrismaService } from '../services/prisma.service.ts';

type UserIncludeRolePermissionsType = UserType & {
  role: RoleType & { permissions: PermissionType[] };
};

export type WhereUniqueUserType = { id: string } | { email: string };

@Injectable()
export class SharedUserRepository {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  findUnique(where: WhereUniqueUserType): Promise<UserType | null> {
    return this.prisma.user.findFirst({
      where: {
        ...where,
        deletedAt: null,
      },
    });
  }

  findUniqueIncludeRolePermissions(
    where: WhereUniqueUserType,
  ): Promise<UserIncludeRolePermissionsType | null> {
    return this.prisma.user
      .findFirst({
        where: {
          ...where,
          deletedAt: null,
        },
        include: {
          userRoles: {
            where: {
              deletedAt: null,
              role: {
                deletedAt: null,
              },
            },
            include: {
              role: {
                include: {
                  rolePermissions: {
                    where: {
                      deletedAt: null,
                      permission: {
                        deletedAt: null,
                      },
                    },
                    include: {
                      permission: true,
                    },
                  },
                },
              },
            },
            take: 1,
          },
        },
      })
      .then((user) => {
        if (!user) {
          return null;
        }

        const userRole = user.userRoles[0];
        if (!userRole) {
          return null;
        }

        const { rolePermissions, ...roleData } = userRole.role;
        const { userRoles, ...userData } = user;

        return {
          ...userData,
          role: {
            ...roleData,
            permissions: rolePermissions.map(
              ({ permission }) => permission as PermissionType,
            ),
          } as RoleType & { permissions: PermissionType[] },
        };
      });
  }

  update(where: { id: string }, data: Partial<UserType>): Promise<UserType> {
    return this.prisma.user.update({
      where: {
        ...where,
        deletedAt: null,
      },
      data,
    });
  }
}
