import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.ts';
import { PermissionScope } from '../../../shared/constants/role.constant.ts';
import { ProjectAccessPolicy } from '../../project/project-access.policy.ts';
import { ProjectDraftRepo } from '../project-draft.repo.ts';
import { ProjectDraftService } from '../project-draft.service.ts';
import { prepareProjectDraftContent } from '../project-draft.util.ts';

vi.mock('../../project/project-access.policy.ts', () => ({
  ProjectAccessPolicy: class ProjectAccessPolicy {},
}));
vi.mock('../project-draft.repo.ts', () => ({
  ProjectDraftRepo: class ProjectDraftRepo {},
}));

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const DRAFT_ID = '33333333-3333-4333-8333-333333333333';
const SAVED_AT = new Date('2026-10-13T12:00:00.000Z');
const ACCESS = { unrestricted: false as const, publisherAccountId: 'publisher-id' };

function input(expectedVersion = 0) {
  return {
    expectedVersion,
    editorGraph: { nodes: [] },
    inputSchema: {},
    runtimeIr: null,
    validationSummary: {},
    testSummary: {},
  };
}

function storedDraft(contentHash: string, version = 1) {
  return {
    id: DRAFT_ID,
    projectId: PROJECT_ID,
    version,
    editorGraph: { nodes: [] },
    inputSchema: {},
    runtimeIr: null,
    validationSummary: {},
    testSummary: {},
    contentHash,
    savedAt: SAVED_AT,
  };
}

describe('ProjectDraftService', () => {
  const resolveReadAccess = vi.fn();
  const resolveDraftSaveAccess = vi.fn();
  const getAccessibleProject = vi.fn();
  const create = vi.fn();
  const updateChanged = vi.fn();
  let service: ProjectDraftService;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveReadAccess.mockResolvedValue(ACCESS);
    resolveDraftSaveAccess.mockResolvedValue(ACCESS);
    service = new ProjectDraftService(
      { getAccessibleProject, create, updateChanged } as unknown as ProjectDraftRepo,
      { resolveReadAccess, resolveDraftSaveAccess } as unknown as ProjectAccessPolicy,
    );
  });

  it('returns null when an accessible Project has no draft', async () => {
    getAccessibleProject.mockResolvedValue({ status: 'ACTIVE', ProjectDraft: null });

    await expect(
      service.get({ projectId: PROJECT_ID, userId: USER_ID, scopes: [PermissionScope.OWN] }),
    ).resolves.toEqual({ projectStatus: 'ACTIVE', draft: null });
  });

  it('creates version 1 on the first save', async () => {
    const created = { id: DRAFT_ID, version: 1, contentHash: 'a'.repeat(64), savedAt: SAVED_AT };
    getAccessibleProject.mockResolvedValue({ status: 'ACTIVE', ProjectDraft: null });
    create.mockResolvedValue(created);

    await expect(
      service.save({
        projectId: PROJECT_ID,
        data: input(),
        userId: USER_ID,
        scopes: [PermissionScope.OWN],
      }),
    ).resolves.toEqual(created);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, savedById: USER_ID }),
    );
  });

  it('resolves a concurrent first-save unique conflict as an idempotent retry', async () => {
    const contentHash = prepareProjectDraftContent(input()).contentHash;
    getAccessibleProject
      .mockResolvedValueOnce({ status: 'ACTIVE', ProjectDraft: null })
      .mockResolvedValueOnce({ status: 'ACTIVE', ProjectDraft: storedDraft(contentHash) });
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.save({
        projectId: PROJECT_ID,
        data: input(),
        userId: USER_ID,
        scopes: [PermissionScope.OWN],
      }),
    ).resolves.toEqual({ id: DRAFT_ID, version: 1, contentHash, savedAt: SAVED_AT });
  });

  it('returns an identical retry without updating save metadata', async () => {
    const contentHash = prepareProjectDraftContent(input()).contentHash;
    getAccessibleProject
      .mockResolvedValueOnce({ status: 'ACTIVE', ProjectDraft: storedDraft(contentHash) })
      .mockResolvedValueOnce({ status: 'ACTIVE', ProjectDraft: storedDraft(contentHash) });

    await expect(
      service.save({
        projectId: PROJECT_ID,
        data: input(),
        userId: USER_ID,
        scopes: [PermissionScope.OWN],
      }),
    ).resolves.toEqual({ id: DRAFT_ID, version: 1, contentHash, savedAt: SAVED_AT });
    expect(create).not.toHaveBeenCalled();
    expect(updateChanged).not.toHaveBeenCalled();
  });

  it('increments through the conditional update for changed content', async () => {
    const updated = { id: DRAFT_ID, version: 2, contentHash: 'b'.repeat(64), savedAt: SAVED_AT };
    getAccessibleProject.mockResolvedValue({ status: 'ACTIVE', ProjectDraft: storedDraft('old') });
    updateChanged.mockResolvedValue([updated]);

    await expect(
      service.save({
        projectId: PROJECT_ID,
        data: input(1),
        userId: USER_ID,
        scopes: [PermissionScope.OWN],
      }),
    ).resolves.toEqual(updated);
    expect(updateChanged).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 1, access: ACCESS }),
    );
  });

  it('returns current metadata for an idempotent retry after a zero-row update', async () => {
    const contentHash = prepareProjectDraftContent(input(1)).contentHash;
    getAccessibleProject
      .mockResolvedValueOnce({
        status: 'ACTIVE',
        ProjectDraft: storedDraft('old', 2),
      })
      .mockResolvedValueOnce({
        status: 'ACTIVE',
        ProjectDraft: storedDraft(contentHash, 2),
      });
    updateChanged.mockResolvedValue([]);

    await expect(
      service.save({
        projectId: PROJECT_ID,
        data: input(1),
        userId: USER_ID,
        scopes: [PermissionScope.OWN],
      }),
    ).resolves.toEqual({ id: DRAFT_ID, version: 2, contentHash, savedAt: SAVED_AT });
  });

  it('returns the current version for a stale differing save', async () => {
    getAccessibleProject
      .mockResolvedValueOnce({ status: 'ACTIVE', ProjectDraft: storedDraft('old', 3) })
      .mockResolvedValueOnce({ status: 'ACTIVE', ProjectDraft: storedDraft('winner', 3) });
    updateChanged.mockResolvedValue([]);

    try {
      await service.save({
        projectId: PROJECT_ID,
        data: input(1),
        userId: USER_ID,
        scopes: [PermissionScope.OWN],
      });
      expect.fail('Expected a version conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual({
        message: 'Error.ProjectDraftVersionConflict',
        details: { currentVersion: 3 },
      });
    }
  });

  it('keeps archived drafts readable but rejects saves', async () => {
    getAccessibleProject.mockResolvedValue({
      status: 'ARCHIVED',
      ProjectDraft: storedDraft('old'),
    });

    await expect(
      service.get({ projectId: PROJECT_ID, userId: USER_ID, scopes: [PermissionScope.OWN] }),
    ).resolves.toEqual(expect.objectContaining({ projectStatus: 'ARCHIVED' }));
    await expect(
      service.save({
        projectId: PROJECT_ID,
        data: input(1),
        userId: USER_ID,
        scopes: [PermissionScope.OWN],
      }),
    ).rejects.toThrow('Error.ProjectArchived');
  });
});
