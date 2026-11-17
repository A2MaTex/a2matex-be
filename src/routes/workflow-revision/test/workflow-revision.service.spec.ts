import { ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.ts';
import { TransactionService } from '../../../shared/services/transaction.service.ts';
import { calculateProjectDraftSourceHash } from '../../project-draft/project-draft.util.ts';
import { WorkflowRevisionRepo } from '../workflow-revision.repo.ts';
import { WorkflowRevisionService } from '../workflow-revision.service.ts';

vi.mock('../../../shared/services/transaction.service.ts', () => ({
  TransactionService: class TransactionService {},
}));
vi.mock('../workflow-revision.repo.ts', () => ({
  WorkflowRevisionRepo: class WorkflowRevisionRepo {},
}));

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REVISION_ID = '33333333-3333-4333-8333-333333333333';
const ACCESS = { unrestricted: false as const, publisherAccountId: 'publisher-id' };

function draft(overrides: Record<string, unknown> = {}) {
  const content = {
    editorGraph: { nodes: [{ id: 'node-1', type: 'utility.delay' }], assets: [] },
    inputSchema: {},
  };
  return {
    version: 4,
    ...content,
    validationSummary: {},
    contentHash: calculateProjectDraftSourceHash(content),
    ...overrides,
  };
}

function definition() {
  return {
    type: 'utility.delay',
    name: 'Delay',
    description: 'Wait for a duration',
    category: 'UTILITY',
    runtimeHandler: 'utility.delay',
    minimumRuntimeVersion: '0.1.0',
    defaultTimeoutMs: 10_000,
    configSchema: {},
    inputSchema: {},
    outputSchema: {},
    outputPorts: {},
    editorHints: {},
    contentHash: 'b'.repeat(64),
    NodeDefinitionCapability: [{ Capability: { code: 'timer.wait' } }],
  };
}

describe('WorkflowRevisionService', () => {
  const lockOwnedProject = vi.fn();
  const lockProjectDraft = vi.fn();
  const getActiveNodeDefinitions = vi.fn();
  const create = vi.fn();
  const runInTransaction = vi.fn((callback: () => unknown) => callback());
  let service: WorkflowRevisionService;

  beforeEach(() => {
    vi.clearAllMocks();
    lockOwnedProject.mockResolvedValue({ status: 'ACTIVE' });
    lockProjectDraft.mockResolvedValue(draft());
    getActiveNodeDefinitions.mockResolvedValue([definition()]);
    create.mockResolvedValue({
      id: REVISION_ID,
      projectId: PROJECT_ID,
      sourceDraftVersion: 4,
      sourceDraftContentHash: draft().contentHash,
      contentHash: 'c'.repeat(64),
    });
    service = new WorkflowRevisionService(
      {
        lockOwnedProject,
        lockProjectDraft,
        getActiveNodeDefinitions,
        create,
      } as unknown as WorkflowRevisionRepo,
      { runInTransaction } as unknown as TransactionService,
    );
  });

  async function createRevision(
    overrides: Partial<Parameters<WorkflowRevisionService['createFromDraft']>[0]> = {},
  ) {
    return service.createFromDraft({
      projectId: PROJECT_ID,
      sourceDraftVersion: 4,
      createdById: USER_ID,
      access: ACCESS,
      ...overrides,
    });
  }

  it('creates an asset-free immutable snapshot inside a transaction', async () => {
    await expect(createRevision()).resolves.toEqual(
      expect.objectContaining({ id: REVISION_ID, sourceDraftVersion: 4 }),
    );
    expect(runInTransaction).toHaveBeenCalledTimes(1);
    expect(lockOwnedProject).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      publisherAccountId: 'publisher-id',
    });
    expect(getActiveNodeDefinitions).toHaveBeenCalledWith(['utility.delay']);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        sourceDraftVersion: 4,
        createdById: USER_ID,
        snapshot: expect.objectContaining({
          nodeDefinitionManifest: expect.any(Object),
          capabilityManifest: expect.any(Object),
        }),
      }),
    );
  });

  it('rejects unrestricted Admin access before querying the Project', async () => {
    await expect(createRevision({ access: { unrestricted: true } })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(lockOwnedProject).not.toHaveBeenCalled();
  });

  it('hides missing and cross-owner Projects behind ProjectNotFound', async () => {
    lockOwnedProject.mockResolvedValue(null);

    await expect(createRevision()).rejects.toThrow('Error.ProjectNotFound');
    expect(lockProjectDraft).not.toHaveBeenCalled();
  });

  it('treats a missing current draft as ProjectNotFound', async () => {
    lockProjectDraft.mockResolvedValue(null);

    await expect(createRevision()).rejects.toThrow('Error.ProjectNotFound');
  });

  it('rejects archived Projects before locking the draft', async () => {
    lockOwnedProject.mockResolvedValue({ status: 'ARCHIVED' });

    await expect(createRevision()).rejects.toThrow('Error.ProjectArchived');
    expect(lockProjectDraft).not.toHaveBeenCalled();
  });

  it('returns the current draft version for stale submission input', async () => {
    lockProjectDraft.mockResolvedValue(draft({ version: 6 }));

    try {
      await createRevision();
      expect.fail('Expected a version conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual({
        message: 'Error.WorkflowRevisionDraftVersionConflict',
        details: { currentVersion: 6 },
      });
    }
  });

  // Requiring it would force Studio to upload preview output before every submission.
  it('accepts a draft whose cached Runtime IR is null and freezes no compiled fields', async () => {
    lockProjectDraft.mockResolvedValue(draft({ runtimeIr: null }));

    await expect(createRevision()).resolves.toEqual(
      expect.objectContaining({ id: REVISION_ID, sourceDraftVersion: 4 }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.not.objectContaining({ runtimeIr: expect.anything() }),
      }),
    );
  });

  it('rejects asset references before the Asset module exists', async () => {
    const assetDraft = draft();
    const editorGraph = {
      ...(assetDraft.editorGraph as Record<string, unknown>),
      assets: [{ alias: 'private-input' }],
    };
    lockProjectDraft.mockResolvedValue(
      draft({
        editorGraph,
        contentHash: calculateProjectDraftSourceHash({
          editorGraph,
          inputSchema: assetDraft.inputSchema,
        }),
      }),
    );

    await expect(createRevision()).rejects.toThrow('Error.WorkflowRevisionAssetUnsupported');
  });

  it('rejects a stored draft hash mismatch', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    lockProjectDraft.mockResolvedValue(draft({ contentHash: 'f'.repeat(64) }));

    await expect(createRevision()).rejects.toThrow('Error.WorkflowRevisionSourceIntegrityFailed');
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining(`projectId=${PROJECT_ID}`));
    errorLog.mockRestore();
  });

  it('freezes the graph even when a node definition is unavailable', async () => {
    getActiveNodeDefinitions.mockResolvedValue([]);

    await expect(createRevision()).resolves.toEqual(expect.objectContaining({ id: REVISION_ID }));
    expect(getActiveNodeDefinitions).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          nodeDefinitionManifest: { schemaVersion: 1, definitions: [] },
        }),
      }),
    );
  });

  it('skips malformed graph nodes instead of refusing the freeze', async () => {
    const content = {
      editorGraph: { nodes: [{ id: 'no-type' }, { type: 'utility.delay' }], assets: [] },
      inputSchema: {},
    };
    lockProjectDraft.mockResolvedValue(
      draft({ ...content, contentHash: calculateProjectDraftSourceHash(content) }),
    );

    await expect(createRevision()).resolves.toEqual(expect.objectContaining({ id: REVISION_ID }));
    expect(getActiveNodeDefinitions).toHaveBeenCalledWith(['utility.delay']);
  });

  it('translates a duplicate source-version race to a stable conflict', async () => {
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(createRevision()).rejects.toThrow('Error.WorkflowRevisionAlreadyExists');
  });
});
