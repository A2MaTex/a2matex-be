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

  it('rejects invalid JSON shapes loaded from storage', async () => {
    findFirst.mockResolvedValue({
      status: 'ACTIVE',
      ProjectDraft: {
        id: '4f1f22ea-d6bd-4dad-9472-03f4f9122ba1',
        projectId: '1a53bd57-b811-40c8-9235-6157c8aa498e',
        version: 1,
        editorGraph: [],
        inputSchema: {},
        runtimeIr: null,
        validationSummary: {},
        contentHash: 'a'.repeat(64),
        savedAt: new Date(),
      },
    });

    await expect(
      repo.getAccessibleProject({
        projectId: 'project-id',
        access: { unrestricted: true },
      }),
    ).rejects.toThrow();
  });
});
