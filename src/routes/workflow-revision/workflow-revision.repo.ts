import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import { NodeDefinitionStatus } from '../../generated/prisma/enums.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import type {
  CreateWorkflowRevisionOutput,
  LockedWorkflowRevisionDraft,
  LockedWorkflowRevisionProject,
  WorkflowRevisionNodeDefinition,
  WorkflowRevisionSourceSnapshot,
} from './workflow-revision.model.ts';

const WORKFLOW_REVISION_CREATE_SELECT = {
  id: true,
  projectId: true,
  sourceDraftVersion: true,
  sourceDraftContentHash: true,
} satisfies Prisma.WorkflowRevisionSelect;

@Injectable()
export class WorkflowRevisionRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  async lockOwnedProject({
    projectId,
    publisherAccountId,
  }: {
    projectId: string;
    publisherAccountId: string;
  }): Promise<LockedWorkflowRevisionProject | null> {
    const projects = await this.prisma.$queryRaw<LockedWorkflowRevisionProject[]>`
      SELECT status
      FROM "Project"
      WHERE id = ${projectId}::uuid
        AND "publisherAccountId" = ${publisherAccountId}::uuid
        AND "deletedAt" IS NULL
      FOR UPDATE
    `;
    return projects[0] ?? null;
  }

  async lockProjectDraft(projectId: string): Promise<LockedWorkflowRevisionDraft | null> {
    const drafts = await this.prisma.$queryRaw<LockedWorkflowRevisionDraft[]>`
      SELECT
        version,
        "editorGraph",
        "inputSchema",
        "validationSummary",
        "contentHash"
      FROM "ProjectDraft"
      WHERE "projectId" = ${projectId}::uuid
        AND "deletedAt" IS NULL
      FOR UPDATE
    `;
    return drafts[0] ?? null;
  }

  async getActiveNodeDefinitions(nodeTypes: string[]): Promise<WorkflowRevisionNodeDefinition[]> {
    if (nodeTypes.length === 0) {
      return [];
    }

    return this.prisma.nodeDefinition.findMany({
      where: {
        type: { in: nodeTypes },
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
        contentHash: true,
        NodeDefinitionCapability: {
          where: {
            deletedAt: null,
            Capability: { deletedAt: null },
          },
          orderBy: { Capability: { code: 'asc' } },
          select: {
            Capability: { select: { code: true } },
          },
        },
      },
    });
  }

  create({
    projectId,
    sourceDraftVersion,
    sourceDraftContentHash,
    snapshot,
    createdById,
  }: {
    projectId: string;
    sourceDraftVersion: number;
    sourceDraftContentHash: string;
    snapshot: WorkflowRevisionSourceSnapshot;
    createdById: string;
  }): Promise<CreateWorkflowRevisionOutput> {
    return this.prisma.workflowRevision.create({
      data: {
        projectId,
        sourceDraftVersion,
        sourceDraftContentHash,
        editorGraph: snapshot.editorGraph,
        inputSchema: snapshot.inputSchema,
        nodeDefinitionManifest: snapshot.nodeDefinitionManifest,
        capabilityManifest: snapshot.capabilityManifest,
        validationSummary: snapshot.validationSummary,
        // Both stay null until a scan compiles the frozen source successfully.
        runtimeIr: Prisma.DbNull,
        contentHash: null,
        createdById,
      },
      select: WORKFLOW_REVISION_CREATE_SELECT,
    });
  }

  // Null-to-value only, so an authoritative Runtime IR can never be overwritten; a second
  // delivery legitimately writes nothing. `updatedById` stays null: the queue does this.
  async finalizeCompilation({
    workflowRevisionId,
    runtimeIr,
    contentHash,
  }: {
    workflowRevisionId: string;
    runtimeIr: Prisma.InputJsonValue;
    contentHash: string;
  }): Promise<void> {
    await this.prisma.workflowRevision.updateMany({
      where: { id: workflowRevisionId, runtimeIr: { equals: Prisma.DbNull }, contentHash: null },
      data: { runtimeIr, contentHash, updatedAt: new Date() },
    });
  }
}
