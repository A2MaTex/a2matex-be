import { Inject, Injectable, Logger, Optional, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.ts';
import {
  SystemSettingKeyNotRegisteredException,
  settingValueValidationException,
} from './system-setting.error.ts';
import {
  getDefinition,
  registeredKeys,
  settingRegistry,
  type AnySettingRegistry,
  type SettingKey,
  type SettingValue,
} from './system-setting.registry.ts';
import { SystemSettingRepo } from './system-setting.repo.ts';

export type SettingListItem = {
  key: string;
  value: unknown;
  description: string;
  valueSchema: unknown;
  updatedAt: Date | null;
  updatedById: string | null;
};

@Injectable()
export class SystemSettingService implements OnModuleInit {
  private readonly logger = new Logger(SystemSettingService.name);

  constructor(
    @Inject(SystemSettingRepo) private readonly repo: SystemSettingRepo,
    // @Optional so Nest passes undefined and the default applies; a test constructs the
    // service directly with its own declarations, because the real registry is empty
    // until each feature adds its keys.
    @Optional()
    private readonly registry: AnySettingRegistry = settingRegistry,
  ) {}

  // Config that lives in the database cannot be checked the way config.ts checks the
  // environment, because that runs before there is a connection. This is the equivalent
  // gate, and it is the same shape KeyService uses for MASTER_KEY.
  async onModuleInit(): Promise<void> {
    const keys = registeredKeys(this.registry);
    if (keys.length === 0) {
      return;
    }

    const rows = await this.repo.findManyByKeys(keys);
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const problems: string[] = [];

    for (const key of keys) {
      const row = byKey.get(key);
      if (!row) {
        problems.push(`${key}: no row`);
        continue;
      }
      const parsed = this.registry[key]!.schema.safeParse(row.value);
      if (!parsed.success) {
        problems.push(`${key}: ${parsed.error.issues.map((i) => i.message).join(', ')}`);
      }
    }

    if (problems.length > 0) {
      throw new Error(`System settings are missing or invalid: ${problems.join('; ')}`);
    }

    this.logger.log(`Validated ${keys.length} system setting(s)`);
  }

  // Typed read for other modules. The return type comes from the key's own schema, so the
  // caller never casts.
  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const definition = getDefinition(this.registry, key);
    if (!definition) {
      throw SystemSettingKeyNotRegisteredException;
    }
    const row = await this.repo.findByKey(key);
    if (!row) {
      throw new Error(`System setting ${key} has no row`);
    }
    return definition.schema.parse(row.value) as SettingValue<K>;
  }

  async list(): Promise<SettingListItem[]> {
    const keys = registeredKeys(this.registry);
    const rows = await this.repo.findManyByKeys(keys);
    const byKey = new Map(rows.map((row) => [row.key, row]));

    // Driven by the registry, not the table: a key with no row cannot reach here because
    // onModuleInit would have stopped the process.
    return keys.map((key) => {
      const definition = this.registry[key]!;
      const row = byKey.get(key);
      return {
        key,
        value: row?.value ?? null,
        description: definition.description,
        valueSchema: definition.valueSchema,
        updatedAt: row?.updatedAt ?? null,
        updatedById: row?.updatedById ?? null,
      };
    });
  }

  async update(input: {
    key: string;
    value: unknown;
    adminUserId: string;
  }): Promise<SettingListItem> {
    const definition = getDefinition(this.registry, input.key);
    if (!definition) {
      throw SystemSettingKeyNotRegisteredException;
    }

    const result = definition.schema.safeParse(input.value);
    if (!result.success) {
      throw settingValueValidationException(result.error);
    }
    const parsed = result.data as Prisma.InputJsonValue;
    const current = await this.repo.findByKey(input.key);
    if (!current) {
      throw new Error(`System setting ${input.key} has no row`);
    }

    const changedAt = new Date();
    await this.repo.updateValue({
      key: input.key,
      value: parsed,
      changedAt,
      changedById: input.adminUserId,
      auditEntry: {
        at: changedAt.toISOString(),
        by: input.adminUserId,
        from: current.value,
        to: parsed,
      },
    });

    return {
      key: input.key,
      value: parsed,
      description: definition.description,
      valueSchema: definition.valueSchema,
      updatedAt: changedAt,
      updatedById: input.adminUserId,
    };
  }
}
