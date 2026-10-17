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
  prepareWorkflowRevisionSnapshot,
  requireAssetFreeWorkflow,
} from '../workflow-revision.util.ts';

function draft(overrides: Partial<LockedWorkflowRevisionDraft> = {}): LockedWorkflowRevisionDraft {
  return {
    version: 3,
    editorGraph: { nodes: [] },
    inputSchema: {},
    runtimeIr: {},
    validationSummary: {},
    testSummary: {},
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
    supportedErrorPolicies: {},
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

  it('rejects malformed graph nodes without exposing graph content', () => {
    expect(() => extractWorkflowNodeTypes({ nodes: [{ id: 'missing-type' }] })).toThrow(
      WorkflowRevisionSourceIntegrityFailedException,
    );
  });

  it('rejects asset-bearing workflows and accepts an empty asset list', () => {
    expect(() => requireAssetFreeWorkflow({ nodes: [], assets: [] })).not.toThrow();
    expect(() =>
      requireAssetFreeWorkflow({ nodes: [], assets: [{ alias: 'private-input' }] }),
    ).toThrow(WorkflowRevisionAssetUnsupportedException);
  });

  it('freezes definitions and capabilities in deterministic order', () => {
    const snapshot = prepareWorkflowRevisionSnapshot({
      draft: draft(),
      definitions: [
        definition('utility.delay', ['screen.capture', 'android.control']),
        definition('android.tap', ['android.control', 'android.control']),
      ],
    });

    expect(snapshot.nodeDefinitionManifest).toMatchObject({
      schemaVersion: 1,
      definitions: [
        {
          type: 'android.tap',
          capabilityCodes: ['android.control'],
          contentHash: 'b'.repeat(64),
        },
        {
          type: 'utility.delay',
          capabilityCodes: ['android.control', 'screen.capture'],
          contentHash: 'b'.repeat(64),
        },
      ],
    });
    expect(snapshot.capabilityManifest).toEqual({
      schemaVersion: 1,
      capabilities: ['android.control', 'screen.capture'],
    });
  });

  it('produces the same hash for recursively reordered object keys', () => {
    const left = prepareWorkflowRevisionSnapshot({
      draft: draft({ runtimeIr: { z: 1, nested: { b: 2, a: 1 } } }),
      definitions: [definition('utility.delay', [])],
    });
    const right = prepareWorkflowRevisionSnapshot({
      draft: draft({ runtimeIr: { nested: { a: 1, b: 2 }, z: 1 } }),
      definitions: [definition('utility.delay', [])],
    });

    expect(left.contentHash).toBe(right.contentHash);
  });

  it('changes the hash when included technical content changes', () => {
    const original = prepareWorkflowRevisionSnapshot({
      draft: draft(),
      definitions: [definition('utility.delay', [])],
    });
    const changed = prepareWorkflowRevisionSnapshot({
      draft: draft({ runtimeIr: { instruction: 'WAIT' } }),
      definitions: [definition('utility.delay', [])],
    });

    expect(original.contentHash).not.toBe(changed.contentHash);
  });

  it('enforces the revision canonical-content limit', () => {
    const oversizedDescription = 'x'.repeat(2_100_000);

    expect(() =>
      prepareWorkflowRevisionSnapshot({
        draft: draft(),
        definitions: [
          definition('utility.delay', [], { description: oversizedDescription as string }),
        ],
      }),
    ).toThrow(WorkflowRevisionPayloadTooLargeException);
  });

  it('requires every frozen JSON contract to be an object', () => {
    expect(() =>
      prepareWorkflowRevisionSnapshot({
        draft: draft({ inputSchema: [] as Prisma.JsonArray }),
        definitions: [],
      }),
    ).toThrow(WorkflowRevisionSourceIntegrityFailedException);
  });
});
