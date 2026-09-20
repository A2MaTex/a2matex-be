import { Injectable } from '@nestjs/common';
import { RoleName } from '../constants/role.constant.ts';
import { PrismaService } from '../services/prisma.service.ts';
import { RoleType } from '../../entities/role.schema.ts';

@Injectable()
export class SharedRoleRepository {
  private customerRoleId: string | null = null;
  private adminRoleId: string | null = null;

  constructor(private readonly prismaService: PrismaService) {}

  private async getRole(roleName: string) {
    const role: RoleType = await this.prismaService.$queryRaw<RoleType[]>`
    SELECT * FROM "Role" WHERE name = ${roleName} AND "deletedAt" IS NULL LIMIT 1;
  `.then((res: RoleType[]) => {
      if (res.length === 0) {
        throw new Error('Role not found');
      }
      return res[0];
    });
    return role;
  }

  async getCustomerRoleId() {
    if (this.customerRoleId) {
      return this.customerRoleId;
    }
    const role = await this.getRole(RoleName.Customer);

    this.customerRoleId = role.id;
    return role.id;
  }

  async getAdminRoleId() {
    if (this.adminRoleId) {
      return this.adminRoleId;
    }
    const role = await this.getRole(RoleName.Admin);

    this.adminRoleId = role.id;
    return role.id;
  }
}
