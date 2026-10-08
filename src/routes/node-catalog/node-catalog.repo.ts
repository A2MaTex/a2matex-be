import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import { NodeDefinitionStatus } from '../../generated/prisma/enums.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import type { CapabilityDefinitionType } from './definitions/capability-definitions.ts';
import type { NodeDefinitionType } from './node-definition.model.ts';

export type CatalogDefinitionToSync = Omit<NodeDefinitionType, 'capabilities'> & {
  contentHash: string;
  capabilities: string[];
};

export type CatalogSyncResult = {
  created: number;
  updated: number;
  unchanged: number;
  disabled: number;
};

@Injectable()
export class NodeCatalogRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  getActiveCatalog() {
    return this.prisma.nodeDefinition.findMany({
      where: {
        status: NodeDefinitionStatus.ACTIVE,
        deletedAt: null,
      },
      orderBy: { type: 'asc' },
      select: {
        type: true,
        name: true,
        description: true,
        category: true,
        runtimeHandler: true,
        minimumRuntimeVersion: true,
        defaultTimeoutMs: true,
        configSchema: true,
        inputSchema: true,
        outputSchema: true,
        outputPorts: true,
        editorHints: true,
        supportedErrorPolicies: true,
        NodeDefinitionCapability: {
          where: {
            deletedAt: null,
            Capability: { deletedAt: null },
          },
          orderBy: { Capability: { code: 'asc' } },
          select: {
            Capability: {
              select: {
                code: true,
                name: true,
                description: true,
                isSensitive: true,
              },
            },
          },
        },
      },
    });
  }

  async syncCatalog({
    definitions,
    capabilities,
  }: {
    definitions: CatalogDefinitionToSync[];
    capabilities: CapabilityDefinitionType[];
  }): Promise<CatalogSyncResult> {
    return this.prismaService.$transaction(async (prisma) => {
      const existingDefinitions = await prisma.nodeDefinition.findMany({
        select: {
          id: true,
          type: true,
          status: true,
          contentHash: true,
          deletedAt: true,
        },
      });
      const existingByType = new Map(existingDefinitions.map((item) => [item.type, item]));
      const sourceTypes = definitions.map(({ type }) => type);

      const created = definitions.filter(({ type }) => !existingByType.has(type)).length;
      const updated = definitions.filter((definition) => {
        const existing = existingByType.get(definition.type);
        return (
          existing &&
          (existing.contentHash !== definition.contentHash ||
            existing.status !== NodeDefinitionStatus.ACTIVE ||
            existing.deletedAt !== null)
        );
      }).length;
      const unchanged = definitions.length - created - updated;
      const disabled = existingDefinitions.filter(
        ({ type, status, deletedAt }) =>
          deletedAt === null &&
          status === NodeDefinitionStatus.ACTIVE &&
          !sourceTypes.includes(type),
      ).length;

      await this.upsertCapabilities(prisma, capabilities);
      await this.upsertNodeDefinitions(prisma, definitions);

      const [storedDefinitions, storedCapabilities] = await Promise.all([
        prisma.nodeDefinition.findMany({
          where: { type: { in: sourceTypes } },
          select: { id: true, type: true },
        }),
        prisma.capability.findMany({
          where: { code: { in: capabilities.map(({ code }) => code) } },
          select: { id: true, code: true },
        }),
      ]);

      await this.syncCapabilityRelations({
        prisma,
        definitions,
        storedDefinitions,
        storedCapabilities,
      });

      const now = new Date();
      await prisma.nodeDefinition.updateMany({
        where: {
          type: { notIn: sourceTypes },
          status: NodeDefinitionStatus.ACTIVE,
          deletedAt: null,
        },
        data: {
          status: NodeDefinitionStatus.DISABLED,
          updatedAt: now,
        },
      });
      await prisma.capability.updateMany({
        where: {
          code: { notIn: capabilities.map(({ code }) => code) },
          deletedAt: null,
        },
        data: {
          deletedAt: now,
          updatedAt: now,
        },
      });

      return { created, updated, unchanged, disabled };
    });
  }

  private upsertCapabilities(
    prisma: Prisma.TransactionClient,
    capabilities: CapabilityDefinitionType[],
  ) {
    const payload = JSON.stringify(capabilities);
    return prisma.$executeRaw`
      WITH incoming AS (
        SELECT *
        FROM jsonb_to_recordset(${payload}::jsonb) AS item(
          code TEXT,
          name TEXT,
          description TEXT,
          "isSensitive" BOOLEAN
        )
      )
      INSERT INTO "Capability" (
        code,
        name,
        description,
        "isSensitive"
      )
      SELECT
        code,
        name,
        description,
        "isSensitive"
      FROM incoming
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        "isSensitive" = EXCLUDED."isSensitive",
        "updatedAt" = now(),
        "deletedAt" = NULL
      WHERE
        "Capability".name IS DISTINCT FROM EXCLUDED.name
        OR "Capability".description IS DISTINCT FROM EXCLUDED.description
        OR "Capability"."isSensitive" IS DISTINCT FROM EXCLUDED."isSensitive"
        OR "Capability"."deletedAt" IS NOT NULL
    `;
  }

  private upsertNodeDefinitions(
    prisma: Prisma.TransactionClient,
    definitions: CatalogDefinitionToSync[],
  ) {
    const payload = JSON.stringify(
      definitions.map(({ capabilities: _capabilities, ...definition }) => definition),
    );
    return prisma.$executeRaw`
      WITH incoming AS (
        SELECT *
        FROM jsonb_to_recordset(${payload}::jsonb) AS item(
          type TEXT,
          name TEXT,
          description TEXT,
          category TEXT,
          "runtimeHandler" TEXT,
          "minimumRuntimeVersion" TEXT,
          "defaultTimeoutMs" INTEGER,
          "configSchema" JSONB,
          "inputSchema" JSONB,
          "outputSchema" JSONB,
          "outputPorts" JSONB,
          "editorHints" JSONB,
          "supportedErrorPolicies" JSONB,
          "contentHash" TEXT
        )
      )
      INSERT INTO "NodeDefinition" (
        type,
        name,
        description,
        category,
        status,
        "runtimeHandler",
        "minimumRuntimeVersion",
        "defaultTimeoutMs",
        "configSchema",
        "inputSchema",
        "outputSchema",
        "outputPorts",
        "editorHints",
        "supportedErrorPolicies",
        "contentHash"
      )
      SELECT
        type,
        name,
        description,
        category,
        'ACTIVE'::"NodeDefinitionStatus",
        "runtimeHandler",
        "minimumRuntimeVersion",
        "defaultTimeoutMs",
        "configSchema",
        "inputSchema",
        "outputSchema",
        "outputPorts",
        "editorHints",
        "supportedErrorPolicies",
        "contentHash"
      FROM incoming
      ON CONFLICT (type) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = EXCLUDED.status,
        "runtimeHandler" = EXCLUDED."runtimeHandler",
        "minimumRuntimeVersion" = EXCLUDED."minimumRuntimeVersion",
        "defaultTimeoutMs" = EXCLUDED."defaultTimeoutMs",
        "configSchema" = EXCLUDED."configSchema",
        "inputSchema" = EXCLUDED."inputSchema",
        "outputSchema" = EXCLUDED."outputSchema",
        "outputPorts" = EXCLUDED."outputPorts",
        "editorHints" = EXCLUDED."editorHints",
        "supportedErrorPolicies" = EXCLUDED."supportedErrorPolicies",
        "contentHash" = EXCLUDED."contentHash",
        "updatedAt" = now(),
        "deletedAt" = NULL
      WHERE
        "NodeDefinition"."contentHash" IS DISTINCT FROM EXCLUDED."contentHash"
        OR "NodeDefinition".status IS DISTINCT FROM EXCLUDED.status
        OR "NodeDefinition"."deletedAt" IS NOT NULL
    `;
  }

  private async syncCapabilityRelations({
    prisma,
    definitions,
    storedDefinitions,
    storedCapabilities,
  }: {
    prisma: Prisma.TransactionClient;
    definitions: CatalogDefinitionToSync[];
    storedDefinitions: Array<{ id: string; type: string }>;
    storedCapabilities: Array<{ id: string; code: string }>;
  }) {
    const nodeIdByType = new Map(storedDefinitions.map((item) => [item.type, item.id]));
    const capabilityIdByCode = new Map(storedCapabilities.map((item) => [item.code, item.id]));
    const desiredRelations = definitions.flatMap((definition) =>
      definition.capabilities.map((code) => ({
        nodeDefinitionId: nodeIdByType.get(definition.type)!,
        capabilityId: capabilityIdByCode.get(code)!,
      })),
    );
    const sourceNodeIds = storedDefinitions.map(({ id }) => id);
    const existingRelations = await prisma.nodeDefinitionCapability.findMany({
      where: { nodeDefinitionId: { in: sourceNodeIds } },
      select: {
        id: true,
        nodeDefinitionId: true,
        capabilityId: true,
        deletedAt: true,
      },
    });

    const relationKey = (nodeDefinitionId: string, capabilityId: string) =>
      `${nodeDefinitionId}:${capabilityId}`;
    const desiredKeys = new Set(
      desiredRelations.map(({ nodeDefinitionId, capabilityId }) =>
        relationKey(nodeDefinitionId, capabilityId),
      ),
    );
    const existingByKey = new Map(
      existingRelations.map((relation) => [
        relationKey(relation.nodeDefinitionId, relation.capabilityId),
        relation,
      ]),
    );
    const staleIds = existingRelations
      .filter(
        ({ nodeDefinitionId, capabilityId, deletedAt }) =>
          deletedAt === null && !desiredKeys.has(relationKey(nodeDefinitionId, capabilityId)),
      )
      .map(({ id }) => id);
    const restoreIds = desiredRelations
      .map(({ nodeDefinitionId, capabilityId }) =>
        existingByKey.get(relationKey(nodeDefinitionId, capabilityId)),
      )
      .filter(
        (relation): relation is NonNullable<typeof relation> =>
          relation !== undefined && relation.deletedAt !== null,
      )
      .map((relation) => relation.id);
    const missingRelations = desiredRelations.filter(
      ({ nodeDefinitionId, capabilityId }) =>
        !existingByKey.has(relationKey(nodeDefinitionId, capabilityId)),
    );
    const now = new Date();

    if (staleIds.length > 0) {
      await prisma.nodeDefinitionCapability.updateMany({
        where: { id: { in: staleIds } },
        data: { deletedAt: now, updatedAt: now },
      });
    }
    if (restoreIds.length > 0) {
      await prisma.nodeDefinitionCapability.updateMany({
        where: { id: { in: restoreIds } },
        data: { deletedAt: null, updatedAt: now },
      });
    }
    if (missingRelations.length > 0) {
      await prisma.nodeDefinitionCapability.createMany({ data: missingRelations });
    }
  }
}
