import { Prisma } from '../../../generated/prisma/client.ts';
import { PrismaService } from '../../../shared/services/prisma.service.ts';
import { ProjectDraftRepo } from '../project-draft.repo.ts';

vi.mock('../../../shared/services/prisma.service.ts', () => ({
  PrismaService: class PrismaService {},
}));

describe('ProjectDraftRepo persistence', () => {
  const findFirst = vi.fn();
  const create = vi.fn();
  const updateManyAndReturn = vi.fn();
  const getClient = vi.fn(() => ({
    project: { findFirst },
    projectDraft: { create, updateManyAndReturn },
  }));
  let repo: ProjectDraftRepo;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ProjectDraftRepo({ getClient } as unknown as PrismaService);
  });

  it('uses an active owned Project predicate in the conditional update', async () => {
    updateManyAndReturn.mockResolvedValue([]);

    await repo.updateChanged({
      projectId: 'project-id',
      expectedVersion: 4,
      content: {
        editorGraph: {},
        inputSchema: {},
        runtimeIr: null,
        validationSummary: {},
        testSummary: {},
      },
      contentHash: 'a'.repeat(64),
      savedById: 'user-id',
      access: { unrestricted: false, publisherAccountId: 'publisher-id' },
    });

    expect(updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: 'project-id',
          version: 4,
          contentHash: { not: 'a'.repeat(64) },
          Project: {
            is: {
              deletedAt: null,
              status: 'ACTIVE',
              publisherAccountId: 'publisher-id',
            },
          },
        }),
        data: expect.objectContaining({
          version: { increment: 1 },
          runtimeIr: Prisma.DbNull,
        }),
      }),
    );
  });

  it('resolves the Prisma client at call time', async () => {
    findFirst.mockResolvedValue(null);

    await repo.getAccessibleProject({
      projectId: 'project-id',
      access: { unrestricted: true },
    });
    await repo.getAccessibleProject({
      projectId: 'project-id',
      access: { unrestricted: true },
    });

    expect(getClient).toHaveBeenCalledTimes(2);
  });
});
