import type { Prisma } from '../../../../generated/prisma/client.ts';
import { NodeCategory } from '../../../node-catalog/node-catalog.constant.ts';
import { SubmissionFindingCode } from '../../../../shared/constants/submission.constant.ts';
import {
  finalizeWorkflowRevisionContentHash,
  prepareWorkflowRevisionSourceSnapshot,
} from '../../../workflow-revision/workflow-revision.util.ts';
import type { WorkflowRevisionNodeDefinition } from '../../../workflow-revision/workflow-revision.model.ts';
import { WorkflowCompilerService } from '../../../workflow-compiler/workflow-compiler.service.ts';
import type { ScanTarget } from '../../submission.repo.ts';
import { SubmissionScannerService } from '../submission-scanner.service.ts';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const PUBLISHER_ID = '33333333-3333-4333-8333-333333333333';
const REVISION_ID = '44444444-4444-4444-8444-444444444444';
const STATIC_ID = '55555555-5555-4555-8555-555555555555';

function nodeDefinition(
  type: string,
  overrides: Partial<WorkflowRevisionNodeDefinition> = {},
): WorkflowRevisionNodeDefinition {
  return {
    type,
    name: type,
    description: `${type} description`,
    category: NodeCategory.FLOW,
    runtimeHandler: type,
    minimumRuntimeVersion: '0.1.0',
    defaultTimeoutMs: 1_000,
    configSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    outputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    outputPorts: { ports: ['success'] },
    editorHints: {},
    contentHash: 'b'.repeat(64),
    NodeDefinitionCapability: [],
    ...overrides,
  };
}

const DEFINITIONS = [
  nodeDefinition('flow.start'),
  nodeDefinition('flow.end', { outputPorts: { ports: [] } }),
  nodeDefinition('android.launch_app', {
    category: NodeCategory.ANDROID,
    defaultTimeoutMs: 30_000,
    configSchema: {
      type: 'object',
      properties: { packageName: { type: 'string' } },
      required: ['packageName'],
      additionalProperties: false,
    },
    outputPorts: { ports: ['success', 'error'] },
    NodeDefinitionCapability: [{ Capability: { code: 'android.device.control' } }],
  }),
];

function editorGraph() {
  const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
    id,
    type,
    config,
    bindings: {},
    errorPolicy: 'STOP',
    editor: { x: 0, y: 0 },
  });
  return {
    schemaVersion: 1,
    entryNodeId: 'start',
    nodes: [
      node('start', 'flow.start'),
      node('launch', 'android.launch_app', { packageName: 'com.example.app' }),
      node('end', 'flow.end'),
    ],
    edges: [
      { id: 'e1', sourceNodeId: 'start', sourcePort: 'success', targetNodeId: 'launch' },
      { id: 'e2', sourceNodeId: 'launch', sourcePort: 'success', targetNodeId: 'end' },
    ],
  };
}

function inputSchema() {
  return { type: 'object', properties: {}, required: [], additionalProperties: false };
}

function source(graph: Record<string, unknown> = editorGraph()) {
  return prepareWorkflowRevisionSourceSnapshot({
    draft: {
      version: 1,
      editorGraph: graph as Prisma.JsonObject,
      inputSchema: inputSchema(),
      validationSummary: {},
      contentHash: 'a'.repeat(64),
    },
    definitions: DEFINITIONS,
  });
}

function target(overrides: Partial<ScanTarget['WorkflowRevision']> = {}): ScanTarget {
  const frozen = source();
  return {
    id: '66666666-6666-4666-8666-666666666666',
    productId: PRODUCT_ID,
    number: 1,
    status: 'PENDING_SCAN',
    scanAttempt: 1,
    scanStatus: 'RUNNING',
    productSnapshot: {
      schemaVersion: 1,
      productId: PRODUCT_ID,
      publisherAccountId: PUBLISHER_ID,
      projectId: PROJECT_ID,
      name: 'Product',
      slug: 'product',
      shortDescription: 'short',
      description: 'description',
      usageInstructions: null,
      media: [{ id: STATIC_ID, staticId: STATIC_ID, type: 'ICON', sortOrder: 0, altText: null }],
    },
    releaseRequest: {
      schemaVersion: 1,
      version: '1.0.0',
      changelog: 'first',
      minimumLauncherVersion: '1.0.0',
      minimumRuntimeVersion: '1.0.0',
    },
    reviewContext: {
      schemaVersion: 1,
      purpose: 'purpose',
      testInstructions: 'run it',
      knownLimitations: [],
    },
    WorkflowRevision: {
      id: REVISION_ID,
      projectId: PROJECT_ID,
      sourceDraftVersion: 1,
      sourceDraftContentHash: 'a'.repeat(64),
      contentHash: null,
      runtimeIr: null,
      ...frozen,
      ...overrides,
    },
  } as unknown as ScanTarget;
}

describe('SubmissionScannerService', () => {
  const compiler = new WorkflowCompilerService({} as never);
  const compileWorkflow = vi.spyOn(compiler, 'compileWorkflow');
  let scanner: SubmissionScannerService;

  beforeEach(() => {
    compileWorkflow.mockClear();
    scanner = new SubmissionScannerService(compiler);
  });

  it('compiles the frozen source once and returns the document to finalize', () => {
    const outcome = scanner.scan(target());

    expect(outcome.result.summary.errors).toBe(0);
    expect(outcome.result.summary.totalRules).toBe(6);
    expect(outcome.compilation).not.toBeNull();
    expect(outcome.compilation?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(compileWorkflow).toHaveBeenCalledTimes(1);
  });

  // A retry must not change its answer when a node type is deactivated afterwards.
  it('passes the frozen definitions to the compiler, converted to the catalog contract', () => {
    scanner.scan(target());

    const [graph, schema, definitions] = compileWorkflow.mock.calls[0] as [
      unknown,
      unknown,
      { type: string; capabilities: string[] }[],
    ];
    expect(graph).toEqual(editorGraph());
    expect(schema).toEqual(inputSchema());
    expect(definitions.map(({ type }) => type).sort()).toEqual([
      'android.launch_app',
      'flow.end',
      'flow.start',
    ]);
    expect(definitions.find(({ type }) => type === 'android.launch_app')?.capabilities).toEqual([
      'android.device.control',
    ]);
    expect(definitions.every((definition) => !('capabilityCodes' in definition))).toBe(true);
    expect(definitions.every((definition) => !('contentHash' in definition))).toBe(true);
  });

  it('writes a hash that matches the one derived from the frozen source and compiled IR', () => {
    const outcome = scanner.scan(target());
    const compiled = compileWorkflow.mock.results[0]?.value as { runtimeIr: unknown };

    expect(outcome.compilation?.contentHash).toBe(
      finalizeWorkflowRevisionContentHash({
        source: source(),
        runtimeIr: compiled.runtimeIr as never,
      }),
    );
  });

  it('reports invalid publisher content as findings and leaves nothing to finalize', () => {
    const broken = editorGraph();
    broken.edges = [];

    const outcome = scanner.scan(target({ ...source(broken) }));

    expect(outcome.result.summary.errors).toBeGreaterThan(0);
    expect(outcome.compilation).toBeNull();
    expect(outcome.result.findings.some((finding) => finding.code === 'EDITOR_GRAPH_INVALID')).toBe(
      true,
    );
  });

  it('does not call the compiler when a frozen document is not an object', () => {
    const outcome = scanner.scan(target({ inputSchema: [] as never }));

    expect(compileWorkflow).not.toHaveBeenCalled();
    expect(outcome.compilation).toBeNull();
    expect(
      outcome.result.findings.some(
        (finding) => finding.code === SubmissionFindingCode.REVISION_CONTENT_INVALID,
      ),
    ).toBe(true);
  });

  it('flags a revision holding only one of its two compiled fields', () => {
    const outcome = scanner.scan(target({ contentHash: 'c'.repeat(64) }));

    expect(
      outcome.result.findings.some(
        (finding) => finding.code === SubmissionFindingCode.REVISION_COMPILATION_STATE_INVALID,
      ),
    ).toBe(true);
    expect(outcome.compilation).toBeNull();
  });

  it('reports a capability manifest that disagrees with the compiled document', () => {
    const frozen = source();
    const outcome = scanner.scan(
      target({
        capabilityManifest: { ...frozen.capabilityManifest, capabilities: ['storage.write'] },
      }),
    );

    expect(
      outcome.result.findings.some(
        (finding) => finding.code === SubmissionFindingCode.RUNTIME_IR_CAPABILITY_MISMATCH,
      ),
    ).toBe(true);
    expect(outcome.compilation).toBeNull();
  });

  it('reports a malformed source draft hash', () => {
    const outcome = scanner.scan(target({ sourceDraftContentHash: 'not-a-digest' }));

    expect(
      outcome.result.findings.some(
        (finding) => finding.code === SubmissionFindingCode.REVISION_CONTENT_INVALID,
      ),
    ).toBe(true);
  });

  // Determinism is the whole reason the manifest is frozen. This definition's timeout is a
  // value no catalog row carries, so the assertion fails the moment anything reads the live
  // Node Catalog instead of the revision.
  it('compiles against the frozen definition, not the live Node Catalog', () => {
    const frozen = prepareWorkflowRevisionSourceSnapshot({
      draft: {
        version: 1,
        editorGraph: editorGraph() as Prisma.JsonObject,
        inputSchema: inputSchema(),
        validationSummary: {},
        contentHash: 'a'.repeat(64),
      },
      definitions: DEFINITIONS.map((definition) =>
        definition.type === 'android.launch_app'
          ? { ...definition, defaultTimeoutMs: 12_345 }
          : definition,
      ),
    });

    const outcome = scanner.scan(target({ ...frozen }));
    const compiled = compileWorkflow.mock.results[0]?.value as {
      runtimeIr: { nodes: { id: string; timeoutMs: number }[] };
    };

    expect(outcome.result.summary.errors).toBe(0);
    expect(compiled.runtimeIr.nodes.find(({ id }) => id === 'launch')?.timeoutMs).toBe(12_345);
  });

  // Source and compiled document each fit; the two together do not.
  it('reports a finalized document over the revision limit as a finding, not a failure', () => {
    const logDefinition = nodeDefinition('utility.log', {
      category: NodeCategory.UTILITY,
      configSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
        additionalProperties: false,
      },
      outputPorts: { ports: ['success'] },
    });
    const graph = editorGraph();
    graph.nodes[1] = {
      id: 'launch',
      type: 'utility.log',
      config: { message: 'x'.repeat(900_000) },
      bindings: {},
      errorPolicy: 'STOP',
      editor: { x: 0, y: 0 },
    };
    const frozen = prepareWorkflowRevisionSourceSnapshot({
      draft: {
        version: 1,
        editorGraph: graph as Prisma.JsonObject,
        inputSchema: inputSchema(),
        validationSummary: { notes: 'y'.repeat(400_000) },
        contentHash: 'a'.repeat(64),
      },
      definitions: [DEFINITIONS[0] as never, DEFINITIONS[1] as never, logDefinition],
    });

    const outcome = scanner.scan(target({ ...frozen }));

    expect(outcome.compilation).toBeNull();
    expect(
      outcome.result.findings.some(
        (finding) => finding.code === SubmissionFindingCode.RUNTIME_IR_COMPILATION_FAILED,
      ),
    ).toBe(true);
  });

  it('reports a frozen Editor Graph over the 1 MiB engine limit without compiling', () => {
    const padded = editorGraph();
    padded.nodes[1] = {
      id: 'launch',
      type: 'android.launch_app',
      config: { packageName: 'com.example.app', note: 'x'.repeat(1_100_000) },
      bindings: {},
      errorPolicy: 'STOP',
      editor: { x: 0, y: 0 },
    };

    const outcome = scanner.scan(target({ ...source(padded) }));

    expect(compileWorkflow).not.toHaveBeenCalled();
    expect(outcome.compilation).toBeNull();
    expect(
      outcome.result.findings.some(
        (finding) => finding.code === SubmissionFindingCode.EDITOR_GRAPH_INVALID,
      ),
    ).toBe(true);
  });

  it('reports a node type with no frozen definition as a finding', () => {
    const frozen = source();
    const definitions = (
      frozen.nodeDefinitionManifest as { definitions: { type: string }[] }
    ).definitions.filter(({ type }) => type !== 'android.launch_app');

    const outcome = scanner.scan(
      target({ nodeDefinitionManifest: { ...frozen.nodeDefinitionManifest, definitions } }),
    );

    expect(compileWorkflow).not.toHaveBeenCalled();
    expect(outcome.compilation).toBeNull();
    const finding = outcome.result.findings.find(
      (item) => item.code === SubmissionFindingCode.NODE_DEFINITION_MISSING,
    );
    expect(finding?.details).toEqual({ nodeTypes: ['android.launch_app'], count: 1 });
  });

  it('reports a frozen manifest with no definition at all', () => {
    const frozen = source();

    const outcome = scanner.scan(
      target({ nodeDefinitionManifest: { ...frozen.nodeDefinitionManifest, definitions: [] } }),
    );

    expect(compileWorkflow).not.toHaveBeenCalled();
    expect(
      outcome.result.findings.some(
        (item) => item.code === SubmissionFindingCode.NODE_DEFINITION_MISSING,
      ),
    ).toBe(true);
  });

  it('still treats an unreadable frozen manifest as a technical failure', () => {
    const frozen = source();

    expect(() =>
      scanner.scan(
        target({ nodeDefinitionManifest: { ...frozen.nodeDefinitionManifest, definitions: 'x' } }),
      ),
    ).toThrow();
  });

  describe('a revision an earlier attempt already finalized', () => {
    function finalized(
      overrides: {
        contentHash?: string;
        storedRuntimeIr?: (runtimeIr: Record<string, unknown>) => Record<string, unknown>;
      } = {},
    ) {
      const frozen = source();
      const compiled = new WorkflowCompilerService({} as never).compileWorkflow(
        frozen.editorGraph,
        frozen.inputSchema,
        (
          frozen.nodeDefinitionManifest as { definitions: Record<string, unknown>[] }
        ).definitions.map(({ capabilityCodes, contentHash: _hash, ...rest }) => ({
          ...rest,
          capabilities: capabilityCodes,
        })),
      );
      if (!compiled.success) {
        throw new Error('fixture workflow must compile');
      }
      const storedRuntimeIr = overrides.storedRuntimeIr
        ? overrides.storedRuntimeIr(compiled.runtimeIr as unknown as Record<string, unknown>)
        : (compiled.runtimeIr as unknown as Record<string, unknown>);

      return target({
        runtimeIr: storedRuntimeIr as never,
        contentHash:
          overrides.contentHash ??
          finalizeWorkflowRevisionContentHash({
            source: frozen,
            runtimeIr: storedRuntimeIr as never,
          }),
      });
    }

    it('converges on the stored value without offering a second write', () => {
      const outcome = scanner.scan(finalized());

      expect(outcome.result.summary.errors).toBe(0);
      expect(outcome.compilation).toBeNull();
    });

    // Unreachable through the application: an operator problem, not a Publisher verdict.
    it('throws when the stored hash does not seal what the row stores', () => {
      expect(() => scanner.scan(finalized({ contentHash: 'd'.repeat(64) }))).toThrow();
    });

    // The pair seals itself, so only recompiling reveals the drift: a separate path.
    it('throws when recompilation does not reproduce the stored document', () => {
      expect(() =>
        scanner.scan(
          finalized({
            storedRuntimeIr: (runtimeIr) => ({ ...runtimeIr, minimumRuntimeVersion: '9.9.9' }),
          }),
        ),
      ).toThrow();
    });
  });
});
