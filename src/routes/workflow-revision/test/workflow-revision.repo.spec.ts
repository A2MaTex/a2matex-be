import { PrismaService } from '../../../shared/services/prisma.service.ts';
import { WorkflowRevisionRepo } from '../workflow-revision.repo.ts';

vi.mock('../../../shared/services/prisma.service.ts', () => ({
  PrismaService: class PrismaService {},
}));

describe('WorkflowRevisionRepo', () => {
  const queryRaw = vi.fn();
  const findMany = vi.fn();
  const create = vi.fn();
  const getClient = vi.fn(() => ({
    $queryRaw: queryRaw,
    nodeDefinition: { findMany },
    workflowRevision: { create },
  }));
  let repo: WorkflowRevisionRepo;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new WorkflowRevisionRepo({ getClient } as unknown as PrismaService);
  });

  it('loads all requested active definitions and capabilities in one query', async () => {
    findMany.mockResolvedValue([]);

    await repo.getActiveNodeDefinitions(['android.tap', 'utility.delay']);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          type: { in: ['android.tap', 'utility.delay'] },
          status: 'ACTIVE',
          deletedAt: null,
        },
        orderBy: { type: 'asc' },
        select: expect.objectContaining({
          contentHash: true,
          NodeDefinitionCapability: expect.any(Object),
        }),
      }),
    );
  });

  it('resolves the Prisma client at call time for transaction participation', async () => {
    queryRaw.mockResolvedValue([]);

    await repo.lockOwnedProject({ projectId: 'project-id', publisherAccountId: 'publisher-id' });
    await repo.lockProjectDraft('project-id');

    expect(getClient).toHaveBeenCalledTimes(2);
  });

  it('inserts only creation fields and the frozen snapshot', async () => {
    create.mockResolvedValue({ id: 'revision-id' });
    const snapshot = {
      editorGraph: {},
      runtimeIr: {},
      inputSchema: {},
      nodeDefinitionManifest: {},
      capabilityManifest: {},
      validationSummary: {},
      testSummary: {},
      contentHash: 'c'.repeat(64),
    };

    await repo.create({
      projectId: 'project-id',
      sourceDraftVersion: 2,
      sourceDraftContentHash: 'a'.repeat(64),
      snapshot,
      createdById: 'user-id',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        projectId: 'project-id',
        sourceDraftVersion: 2,
        sourceDraftContentHash: 'a'.repeat(64),
        ...snapshot,
        createdById: 'user-id',
      },
      select: {
        id: true,
        projectId: true,
        sourceDraftVersion: true,
        sourceDraftContentHash: true,
        contentHash: true,
      },
    });
  });
});
