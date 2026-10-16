import { NodeDefinitionStatus } from '../../../generated/prisma/enums.ts';
import { PrismaService } from '../../../shared/services/prisma.service.ts';
import { WorkflowValidationRepo } from '../workflow-validation.repo.ts';

vi.mock('../../../shared/services/prisma.service.ts', () => ({
  PrismaService: class PrismaService {},
}));

describe('WorkflowValidationRepo', () => {
  const nodeDefinitionFindMany = vi.fn();
  const repository = new WorkflowValidationRepo({
    getClient: () => ({
      nodeDefinition: { findMany: nodeDefinitionFindMany },
    }),
  } as unknown as PrismaService);

  beforeEach(() => vi.clearAllMocks());

  it('loads all requested active definitions in one query with only engine fields', async () => {
    await repository.getActiveNodeDefinitions(['flow.start', 'flow.end']);

    expect(nodeDefinitionFindMany).toHaveBeenCalledTimes(1);
    expect(nodeDefinitionFindMany).toHaveBeenCalledWith({
      where: {
        type: { in: ['flow.start', 'flow.end'] },
        status: NodeDefinitionStatus.ACTIVE,
        deletedAt: null,
      },
      select: {
        type: true,
        configSchema: true,
        outputPorts: true,
      },
    });
  });
});
