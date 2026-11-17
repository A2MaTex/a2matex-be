import { Inject, Injectable } from '@nestjs/common';
import { NodeDefinitionStatus } from '../../generated/prisma/enums.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';

@Injectable()
export class WorkflowCompilerRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  getProjectDraft(projectId: string) {
    return this.prisma.projectDraft.findFirst({
      where: {
        projectId,
        deletedAt: null,
        Project: { is: { deletedAt: null } },
      },
      select: {
        version: true,
        editorGraph: true,
        inputSchema: true,
      },
    });
  }

  getActiveNodeDefinitions(types: string[]) {
    return this.prisma.nodeDefinition.findMany({
      where: {
        type: { in: types },
        status: NodeDefinitionStatus.ACTIVE,
        deletedAt: null,
      },
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
        NodeDefinitionCapability: {
          where: {
            deletedAt: null,
            Capability: { deletedAt: null },
          },
          orderBy: { Capability: { code: 'asc' } },
          select: { Capability: { select: { code: true } } },
        },
      },
    });
  }
}
