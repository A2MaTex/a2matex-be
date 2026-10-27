import { Inject, Injectable } from '@nestjs/common';
import { NodeDefinitionStatus } from '../../generated/prisma/enums.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';

@Injectable()
export class WorkflowValidationRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  /**
   * Load the current validation authority in one set-based query.
   * Disabled/deleted definitions are deliberately indistinguishable from unknown node types.
   * Selecting only these three fields avoids moving complete catalog rows into request memory.
   */
  getActiveNodeDefinitions(types: string[]) {
    return this.prisma.nodeDefinition.findMany({
      where: {
        type: { in: types },
        status: NodeDefinitionStatus.ACTIVE,
        deletedAt: null,
      },
      select: {
        type: true,
        configSchema: true,
        outputPorts: true,
      },
    });
  }
}
