import { BASIC_NODE_DEFINITIONS } from '../node-catalog/definitions/basic-node-definitions.ts';
import type { WorkflowCompilerRepo } from './workflow-compiler.repo.ts';
import { WorkflowCompilerService } from './workflow-compiler.service.ts';

const EMPTY_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
} as const;

function node(id: string, type: string, bindings: Record<string, unknown> = {}) {
  return {
    id,
    type,
    config: {},
    bindings,
    errorPolicy: 'STOP',
    editor: { x: 0, y: 0 },
  };
}

describe('WorkflowCompilerService', () => {
  const compiler = new WorkflowCompilerService({} as WorkflowCompilerRepo);

  it('compiles bindings and resolves execution defaults into strict Runtime IR', () => {
    const graph = {
      schemaVersion: 1,
      entryNodeId: 'start',
      nodes: [
        node('start', 'flow.start'),
        {
          ...node('delay', 'flow.delay', {
            durationMs: { kind: 'WORKFLOW_INPUT', inputName: 'durationMs' },
          }),
          timeoutMs: 5_000,
          retryPolicy: { maxAttempts: 2 },
        },
        node('end', 'flow.end'),
      ],
      edges: [
        {
          id: 'start_delay',
          sourceNodeId: 'start',
          sourcePort: 'success',
          targetNodeId: 'delay',
        },
        {
          id: 'delay_end',
          sourceNodeId: 'delay',
          sourcePort: 'success',
          targetNodeId: 'end',
        },
      ],
    };
    const inputSchema = {
      type: 'object',
      properties: { durationMs: { type: 'integer', minimum: 0, maximum: 300_000 } },
      required: ['durationMs'],
      additionalProperties: false,
    };

    const result = compiler.compileWorkflow(graph, inputSchema, BASIC_NODE_DEFINITIONS);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.runtimeIr.nodes).toEqual([
      expect.objectContaining({
        id: 'start',
        runtimeHandler: 'flow.start',
        inputs: {},
        timeoutMs: 1_000,
        retryPolicy: { maxAttempts: 1, delayMs: 0 },
      }),
      expect.objectContaining({
        id: 'delay',
        inputs: { durationMs: { source: 'WORKFLOW_INPUT', inputName: 'durationMs' } },
        timeoutMs: 5_000,
        retryPolicy: { maxAttempts: 2, delayMs: 0 },
      }),
      expect.objectContaining({ id: 'end', timeoutMs: 1_000 }),
    ]);
    expect(result.runtimeIr.nodes[0]).not.toHaveProperty('editor');
    expect(result.runtimeIr.minimumRuntimeVersion).toBe('0.1.0');
  });

  it('deduplicates capabilities in first-use order', () => {
    const graph = {
      schemaVersion: 1,
      entryNodeId: 'start',
      nodes: [
        node('start', 'flow.start'),
        node('home', 'android.press_home'),
        node('screen', 'android.screenshot'),
        node('end', 'flow.end'),
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'start', sourcePort: 'success', targetNodeId: 'home' },
        { id: 'e2', sourceNodeId: 'home', sourcePort: 'success', targetNodeId: 'screen' },
        { id: 'e3', sourceNodeId: 'screen', sourcePort: 'success', targetNodeId: 'end' },
      ],
    };

    const result = compiler.compileWorkflow(graph, EMPTY_INPUT_SCHEMA, BASIC_NODE_DEFINITIONS);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.runtimeIr.requiredCapabilities).toEqual([
      'android.device.control',
      'android.screen.capture',
    ]);
  });

  it('returns diagnostics without partial Runtime IR for invalid publisher input', () => {
    const graph = {
      schemaVersion: 1,
      entryNodeId: 'start',
      nodes: [node('start', 'flow.start'), node('end', 'flow.end')],
      edges: [],
    };

    const result = compiler.compileWorkflow(graph, EMPTY_INPUT_SCHEMA, BASIC_NODE_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty('runtimeIr');
    expect(result.validation.status).toBe('INVALID');
  });

  it('rejects unsupported workflow input schema features before compilation', () => {
    const graph = {
      schemaVersion: 1,
      entryNodeId: 'start',
      nodes: [node('start', 'flow.start'), node('end', 'flow.end')],
      edges: [{ id: 'edge', sourceNodeId: 'start', sourcePort: 'success', targetNodeId: 'end' }],
    };

    const result = compiler.compileWorkflow(
      graph,
      {
        ...EMPTY_INPUT_SCHEMA,
        properties: { amount: { type: 'number' } },
      },
      BASIC_NODE_DEFINITIONS,
    );

    expect(result.success).toBe(false);
    expect(result.validation.errors[0]?.code).toBe('WORKFLOW_INPUT_SCHEMA_INVALID');
  });
});
