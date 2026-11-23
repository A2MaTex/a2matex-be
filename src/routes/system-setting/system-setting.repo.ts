import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';

export type SettingRow = {
  key: string;
  value: unknown;
  updatedAt: Date | null;
  updatedById: string | null;
};

export type SettingAuditEntry = {
  at: string;
  by: string;
  from: unknown;
  to: unknown;
};

@Injectable()
export class SystemSettingRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  findByKey(key: string): Promise<SettingRow | null> {
    return this.prisma.systemSetting.findUnique({
      where: { key },
      select: { key: true, value: true, updatedAt: true, updatedById: true },
    });
  }

  findManyByKeys(keys: string[]): Promise<SettingRow[]> {
    return this.prisma.systemSetting.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true, updatedAt: true, updatedById: true },
    });
  }

  // Value and history move in one statement. Reading the array out and writing it back
  // would drop the other entry when two Admins save at the same time; last write wins on
  // the value is acceptable, losing a history entry is not.
  async updateValue(input: {
    key: string;
    value: Prisma.InputJsonValue;
    auditEntry: SettingAuditEntry;
    changedAt: Date;
    changedById: string;
  }): Promise<number> {
    const entry: Prisma.InputJsonObject = { ...input.auditEntry } as Prisma.InputJsonObject;
    return this.prisma.$executeRaw`
      UPDATE "SystemSetting"
      SET
        "value" = ${input.value}::jsonb,
        "auditHistory" = COALESCE("auditHistory", '[]'::jsonb) || jsonb_build_array(${entry}::jsonb),
        "updatedAt" = ${input.changedAt},
        "updatedById" = ${input.changedById}::uuid
      WHERE "key" = ${input.key}
    `;
  }
}
