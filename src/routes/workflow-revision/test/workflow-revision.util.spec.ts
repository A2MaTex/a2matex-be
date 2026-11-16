import type { Prisma } from '../../../generated/prisma/client.ts';
import {
  WorkflowRevisionAssetUnsupportedException,
  WorkflowRevisionPayloadTooLargeException,
  WorkflowRevisionSourceIntegrityFailedException,
} from '../workflow-revision.error.ts';
import type {
  LockedWorkflowRevisionDraft,
  WorkflowRevisionNodeDefinition,
} from '../workflow-revision.model.ts';
import {
  extractWorkflowNodeTypes,
  finalizeWorkflowRevisionContentHash,
  prepareWorkflowRevisionSourceSnapshot,
  requireAssetFreeWorkflow,
} from '../workflow-revision.util.ts';

function draft(overrides: Partial<LockedWorkflowRevisionDraft> = {}): LockedWorkflowRevisionDraft {
  return {
    version: 3,
    editorGraph: { nodes: [] },
    inputSchema: {},
    validationSummary: {},
    contentHash: 'a'.repeat(64),
    ...overrides,
  };
}

function definition(
  type: string,
  capabilityCodes: string[],
  overrides: Partial<WorkflowRevisionNodeDefinition> = {},
): WorkflowRevisionNodeDefinition {
  return {
    type,
    name: type,
    description: `${type} description`,
    category: 'UTILITY',
    runtimeHandler: type,
    minimumRuntimeVersion: '0.1.0',
    defaultTimeoutMs: 10_000,
    configSchema: {},
    inputSchema: {},
    outputSchema: {},
    outputPorts: {},
    editorHints: {},
    contentHash: 'b'.repeat(64),
    NodeDefinitionCapability: capabilityCodes.map((code) => ({ Capability: { code } })),
    ...overrides,
  };
}

describe('Workflow Revision utilities', () => {
  it('extracts distinct node types in deterministic order', () => {
    expect(
      extractWorkflowNodeTypes({
        nodes: [{ type: 'utility.delay' }, { type: 'android.tap' }, { type: 'utility.delay' }],
      }),
    ).toEqual(['android.tap', 'utility.delay']);
  });

  it('skips malformed graph nodes and a non-array node list', () => {
    expect(
      extractWorkflowNodeTypes({ nodes: [{ id: 'missing-type' }, { type: 'android.tap' }] }),
    ).toEqual(['android.tap']);
    expect(extractWorkflowNodeTypes({ nodes: 'not-an-array' })).toEqual([]);
    expect(extractWorkflowNodeTypes({})).toEqual([]);
  });

  it('rejects asset-bearing workflows and accepts an empty asset list', () => {
    expect(() => requireAssetFreeWorkflow({ nodes: [], assets: [] })).not.toThrow();
    expect(() =>
      requireAssetFreeWorkflow({ nodes: [], assets: [{ alias: 'private-input' }] }),
    ).toThrow(WorkflowRevisionAssetUnsupportedException);
  });

  it('freezes a source snapshot without the two compiled fields', () => {
    const snapshot = prepareWorkflowRevisionSourceSnapshot({
      draft: draft(),
      definitions: [definition('utility.delay', [])],
    });

    expect(Object.keys(snapshot).sort()).toEqual([
      'capabilityManifest',
      'editorGraph',
      'inputSchema',
      'nodeDefinitionManifest',
      'validationSummary',
    ]);
  });

  it('sorts frozen definitions by type and their own capability codes', () => {
    const snapshot = prepareWorkflowRevisionSourceSnapshot({
      draft: draft({
        editorGraph: { nodes: [{ type: 'utility.delay' }, { type: 'android.tap' }] },
      }),
      definitions: [
        definition('utility.delay', ['screen.capture', 'android.control']),
        definition('android.tap', ['android.control', 'android.control']),
      ],
    });

    expect(snapshot.nodeDefinitionManifest).toMatchObject({
      schemaVersion: 1,
      definitions: [
        { type: 'android.tap', capabilityCodes: ['android.control'] },
        { type: 'utility.delay', capabilityCodes: ['android.control', 'screen.capture'] },
      ],
    });
  });

  // The compiler derives requiredCapabilities the same way and the scan compares the two.
  it('derives the capability union in graph order, not lexicographic order', () => {
    const snapshot = prepareWorkflowRevisionSourceSnapshot({
      draft: draft({
        editorGraph: { nodes: [{ type: 'utility.delay' }, { type: 'android.tap' }] },
      }),
      definitions: [
        definition('utility.delay', ['screen.capture']),
        definition('android.tap', ['android.control']),
      ],
    });

    expect(snapshot.capabilityManifest).toEqual({
      schemaVersion: 1,
      capabilities: ['screen.capture', 'android.control'],
    });
  });

  it('ignores a graph node whose type has no frozen definition', () => {
    const snapshot = prepareWorkflowRevisionSourceSnapshot({
      draft: draft({
        editorGraph: { nodes: [{ type: 'android.tap' }, { type: 'utility.unknown' }] },
      }),
      definitions: [definition('android.tap', ['android.control'])],
    });

    expect(snapshot.capabilityManifest).toEqual({
      schemaVersion: 1,
      capabilities: ['android.control'],
    });
  });

  it('enforces the source canonical-content limit', () => {
    const oversizedDescription = 'x'.repeat(2_100_000);

    expect(() =>
      prepareWorkflowRevisionSourceSnapshot({
        draft: draft(),
        definitions: [
          definition('utility.delay', [], { description: oversizedDescription as string }),
        ],
      }),
    ).toThrow(WorkflowRevisionPayloadTooLargeException);
  });

  it('requires every frozen JSON contract to be an object', () => {
    expect(() =>
      prepareWorkflowRevisionSourceSnapshot({
        draft: draft({ inputSchema: [] as Prisma.JsonArray }),
        definitions: [],
      }),
    ).toThrow(WorkflowRevisionSourceIntegrityFailedException);
  });

  describe('finalized content hash', () => {
    const source = () =>
      prepareWorkflowRevisionSourceSnapshot({
        draft: draft(),
        definitions: [definition('utility.delay', [])],
      });

    it('produces the same hash for recursively reordered object keys', () => {
      expect(
        finalizeWorkflowRevisionContentHash({
          source: source(),
          runtimeIr: { z: 1, nested: { b: 2, a: 1 } },
        }),
      ).toBe(
        finalizeWorkflowRevisionContentHash({
          source: source(),
          runtimeIr: { nested: { a: 1, b: 2 }, z: 1 } as Prisma.JsonObject,
        }),
      );
    });

    it('changes when the compiled Runtime IR changes', () => {
      expect(finalizeWorkflowRevisionContentHash({ source: source(), runtimeIr: {} })).not.toBe(
        finalizeWorkflowRevisionContentHash({
          source: source(),
          runtimeIr: { instruction: 'WAIT' },
        }),
      );
    });

    // The source alone fits; only the compiled document pushes the pair over the ceiling.
    it('enforces the limit on the finalized document', () => {
      expect(() =>
        finalizeWorkflowRevisionContentHash({
          source: source(),
          runtimeIr: { padding: 'x'.repeat(2_100_000) },
        }),
      ).toThrow(WorkflowRevisionPayloadTooLargeException);
    });
  });
});
