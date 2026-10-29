import fs from 'node:fs';
import path from 'node:path';
import type { EditorGraphType } from '../workflow-validation.model.ts';
import { EditorGraph } from '../workflow-validation.model.ts';
import { WorkflowValidationRepo } from '../workflow-validation.repo.ts';
import { WorkflowValidationService } from '../workflow-validation.service.ts';

vi.mock('../workflow-validation.repo.ts', () => ({
  WorkflowValidationRepo: class WorkflowValidationRepo {},
}));

const EMPTY_SCHEMA = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
};

function graph(): EditorGraphType {
  const value: unknown = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'valid-minimal.json'), 'utf8'),
  );
  return EditorGraph.parse((value as { editorGraph: unknown }).editorGraph);
}

function storedDefinition(type: string, ports: string[]) {
  return {
    type,
    configSchema: EMPTY_SCHEMA,
    outputPorts: {
      ports: ports.map((key) => ({
        key,
        kind: key === 'error' ? 'ERROR' : 'CONTROL',
        label: key,
      })),
    },
  };
}

describe('WorkflowValidationService', () => {
  const getActiveNodeDefinitions = vi.fn();
  let service: WorkflowValidationService;

  beforeEach(() => {
    vi.clearAllMocks();
    getActiveNodeDefinitions.mockResolvedValue([
      storedDefinition('flow.start', ['success']),
      storedDefinition('flow.end', []),
    ]);
    service = new WorkflowValidationService({
      getActiveNodeDefinitions,
    } as unknown as WorkflowValidationRepo);
  });

  it('validates graph content using one distinct-type catalog query', async () => {
    await expect(service.validate(graph())).resolves.toEqual({
      status: 'VALID',
      errors: [],
      warnings: [],
      truncated: false,
    });

    expect(getActiveNodeDefinitions).toHaveBeenCalledTimes(1);
    expect(getActiveNodeDefinitions).toHaveBeenCalledWith(['flow.start', 'flow.end']);
  });

  it('returns contract diagnostics for malformed graph content', async () => {
    await expect(service.validate({ nodes: [], unexpected: true })).resolves.toEqual(
      expect.objectContaining({
        status: 'INVALID',
        errors: expect.arrayContaining([
          expect.objectContaining({ code: 'EDITOR_GRAPH_CONTRACT_INVALID' }),
        ]),
      }),
    );
    expect(getActiveNodeDefinitions).not.toHaveBeenCalled();
  });

  it('returns graph-limit diagnostics before querying Node Catalog', async () => {
    const oversizedGraph = graph();
    oversizedGraph.nodes = Array.from({ length: 501 }, (_, index) => ({
      ...oversizedGraph.nodes[0],
      id: `node_${index}`,
    }));

    await expect(service.validate(oversizedGraph)).resolves.toEqual(
      expect.objectContaining({
        status: 'INVALID',
        errors: [expect.objectContaining({ code: 'GRAPH_NODE_LIMIT_EXCEEDED' })],
      }),
    );
    expect(getActiveNodeDefinitions).not.toHaveBeenCalled();
  });

  it('rejects graph JSON larger than 1 MiB before catalog access', async () => {
    const largeGraph = graph();
    largeGraph.nodes[0].config = { text: 'x'.repeat(1_048_576) };

    await expect(service.validate(largeGraph)).rejects.toThrow('Error.EditorGraphPayloadTooLarge');
    expect(getActiveNodeDefinitions).not.toHaveBeenCalled();
  });
});
