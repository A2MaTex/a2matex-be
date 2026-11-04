import fs from 'node:fs';
import path from 'node:path';
import { ANDROID_NODE_DEFINITIONS } from '../../node-catalog/definitions/android-node-definitions.ts';
import { BASIC_NODE_DEFINITIONS } from '../../node-catalog/definitions/basic-node-definitions.ts';
import {
  EDITOR_GRAPH_MAX_DIAGNOSTICS,
  EDITOR_GRAPH_MAX_EDGES,
  EDITOR_GRAPH_MAX_NODES,
  WORKFLOW_VALIDATION_DIAGNOSTIC_MESSAGES,
} from '../../../shared/constants/workflow-validation.constant.ts';
import {
  buildValidationOutput,
  validateEditorGraphCatalog,
  validateEditorGraphTopology,
} from '../validator/editor-graph.validator.ts';
import { EditorGraph, type EditorGraphType } from '../workflow-validation.model.ts';
import type { WorkflowNodeDefinitionType } from '../workflow-validation.model.ts';

const targetingCases = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'targeting-parity.json'), 'utf8'),
) as Array<{
  name: string;
  type: string;
  config: EditorGraphType['nodes'][number]['config'];
  bindings: EditorGraphType['nodes'][number]['bindings'];
  paths: string[][];
}>;

const bindingCases = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'binding-parity.json'), 'utf8'),
) as Array<{
  name: string;
  graph: unknown;
  paths: Array<{ node: number; field: string; section?: 'bindings' | 'config' | 'ports' }>;
}>;

describe('binding parity', () => {
  it.each(bindingCases)('$name', ({ graph: raw, paths }) => {
    const graph = EditorGraph.parse(raw);
    const errors = [
      ...validateEditorGraphTopology(graph),
      ...validateEditorGraphCatalog(graph, BASIC_NODE_DEFINITIONS),
    ];
    expect(buildValidationOutput({ errors })).toEqual({
      status: paths.length ? 'INVALID' : 'VALID',
      errors: paths.map(({ node, field, section = 'bindings' }) => {
        const code =
          section === 'ports'
            ? 'SWITCH_PORT_EDGE_COUNT_INVALID'
            : section === 'config'
              ? 'NODE_CONFIG_INVALID'
              : 'NODE_VALUE_BINDING_INVALID';
        return {
          code,
          message: WORKFLOW_VALIDATION_DIAGNOSTIC_MESSAGES[code],
          nodeId: graph.nodes[node].id,
          path: ['nodes', node, section, field],
        };
      }),
      warnings: [],
      truncated: false,
    });
  });
});

describe('targeting parity', () => {
  it.each(targetingCases)('$name', ({ type, config, bindings, paths }) => {
    const graph = EditorGraph.parse({
      schemaVersion: 1,
      entryNodeId: 'start',
      nodes: [
        {
          id: 'start',
          type: 'flow.start',
          config: {},
          bindings: {},
          errorPolicy: 'STOP',
          editor: { x: 0, y: 0 },
        },
        { id: 'target', type, config, bindings, errorPolicy: 'STOP', editor: { x: 0, y: 0 } },
        {
          id: 'end',
          type: 'flow.end',
          config: {},
          bindings: {},
          errorPolicy: 'STOP',
          editor: { x: 0, y: 0 },
        },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'start', sourcePort: 'success', targetNodeId: 'target' },
        { id: 'e2', sourceNodeId: 'target', sourcePort: 'success', targetNodeId: 'end' },
      ],
    });
    const target = ANDROID_NODE_DEFINITIONS.find((entry) => entry.type === type);
    if (!target) throw new Error(`Unknown fixture node type ${type}`);
    const errors = [
      ...validateEditorGraphTopology(graph),
      ...validateEditorGraphCatalog(graph, [
        definition('flow.start', ['success']),
        target,
        definition('flow.end', []),
      ]),
    ];
    expect(buildValidationOutput({ errors })).toEqual({
      status: paths.length ? 'INVALID' : 'VALID',
      errors: paths.map((segments) => {
        const code = segments[0] === 'config' ? 'NODE_CONFIG_INVALID' : 'NODE_BINDINGS_INVALID';
        return {
          code,
          message: WORKFLOW_VALIDATION_DIAGNOSTIC_MESSAGES[code],
          nodeId: 'target',
          path: ['nodes', 1, ...segments],
        };
      }),
      warnings: [],
      truncated: false,
    });
  });
});

function fixture(name: string): EditorGraphType {
  const value: unknown = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8'),
  );
  return EditorGraph.parse((value as { editorGraph: unknown }).editorGraph);
}

function codes(graph: EditorGraphType): string[] {
  return validateEditorGraphTopology(graph).map(({ code }) => code);
}

const EMPTY_SCHEMA = {
  type: 'object' as const,
  properties: {},
  required: [],
  additionalProperties: false as const,
};

function definition(
  type: string,
  ports: string[],
  configSchema: WorkflowNodeDefinitionType['configSchema'] = EMPTY_SCHEMA,
): WorkflowNodeDefinitionType {
  return {
    type,
    configSchema,
    outputPorts: {
      ports: ports.map((key) => ({
        key: key as WorkflowNodeDefinitionType['outputPorts']['ports'][number]['key'],
        kind: key === 'error' ? ('ERROR' as const) : ('CONTROL' as const),
        label: key,
      })),
    },
  };
}

describe('validateEditorGraph', () => {
  it('accepts a minimal Start to End graph', () => {
    expect(
      buildValidationOutput({ errors: validateEditorGraphTopology(fixture('valid-minimal.json')) }),
    ).toEqual({
      status: 'VALID',
      errors: [],
      warnings: [],
      truncated: false,
    });
  });

  it('reports unsupported schema versions without rejecting the transport shape', () => {
    const graph = fixture('valid-minimal.json');
    graph.schemaVersion = 2;

    expect(codes(graph)).toContain('GRAPH_SCHEMA_VERSION_UNSUPPORTED');
  });

  it('reports duplicate node and edge IDs in deterministic order', () => {
    const graph = fixture('valid-minimal.json');
    graph.nodes.push({ ...graph.nodes[1] });
    graph.edges.push({ ...graph.edges[0] });

    const first = buildValidationOutput({ errors: validateEditorGraphTopology(graph) });
    const second = buildValidationOutput({ errors: validateEditorGraphTopology(graph) });

    expect(first).toEqual(second);
    expect(first.errors.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['EDGE_ID_DUPLICATED', 'NODE_ID_DUPLICATED']),
    );
  });

  it('requires exactly one Start node and a matching entry node', () => {
    const noStart = fixture('valid-minimal.json');
    noStart.nodes[0].type = 'flow.delay';

    expect(codes(noStart)).toEqual(
      expect.arrayContaining([
        'START_NODE_COUNT_INVALID',
        'ENTRY_NODE_INVALID',
        'END_NODE_UNREACHABLE',
      ]),
    );

    const wrongEntry = fixture('valid-minimal.json');
    wrongEntry.entryNodeId = 'end_01';
    expect(codes(wrongEntry)).toContain('ENTRY_NODE_INVALID');

    const multipleStarts = fixture('valid-minimal.json');
    multipleStarts.nodes.push({
      ...multipleStarts.nodes[0],
      id: 'start_02',
    });
    expect(codes(multipleStarts)).toEqual(
      expect.arrayContaining(['START_NODE_COUNT_INVALID', 'ENTRY_NODE_INVALID']),
    );
  });

  it('reports missing edge endpoints without crashing traversal', () => {
    const graph = fixture('valid-minimal.json');
    graph.edges.push({
      id: 'missing_source',
      sourceNodeId: 'unknown_source',
      sourcePort: 'success',
      targetNodeId: 'end_01',
    });
    graph.edges.push({
      id: 'missing_target',
      sourceNodeId: 'start_01',
      sourcePort: 'success',
      targetNodeId: 'unknown_target',
    });

    expect(codes(graph)).toEqual(
      expect.arrayContaining(['EDGE_SOURCE_NODE_NOT_FOUND', 'EDGE_TARGET_NODE_NOT_FOUND']),
    );
  });

  it('rejects outgoing edges from End nodes', () => {
    const graph = fixture('valid-minimal.json');
    graph.edges.push({
      id: 'edge_from_end',
      sourceNodeId: 'end_01',
      sourcePort: 'success',
      targetNodeId: 'start_01',
    });

    expect(codes(graph)).toContain('END_NODE_HAS_OUTGOING_EDGE');
  });

  it('reports unreachable nodes and the absence of a reachable End', () => {
    const graph = fixture('valid-minimal.json');
    graph.edges = [];

    expect(codes(graph)).toEqual(
      expect.arrayContaining(['NODE_UNREACHABLE', 'END_NODE_UNREACHABLE']),
    );
  });

  it('rejects self-cycles and multi-node cycles', () => {
    expect(codes(fixture('invalid-cycle.json'))).toContain('GRAPH_CYCLE_DETECTED');

    const graph = fixture('valid-minimal.json');
    graph.nodes.splice(1, 0, {
      id: 'delay_01',
      type: 'flow.delay',
      config: {},
      bindings: {},
      errorPolicy: 'STOP',
      editor: { x: 220, y: 180 },
    });
    graph.edges = [
      {
        id: 'edge_01',
        sourceNodeId: 'start_01',
        sourcePort: 'success',
        targetNodeId: 'delay_01',
      },
      {
        id: 'edge_02',
        sourceNodeId: 'delay_01',
        sourcePort: 'success',
        targetNodeId: 'start_01',
      },
      {
        id: 'edge_03',
        sourceNodeId: 'delay_01',
        sourcePort: 'success',
        targetNodeId: 'end_01',
      },
    ];

    expect(codes(graph)).toContain('GRAPH_CYCLE_DETECTED');
  });

  it('fails graph limits before topology validation', () => {
    const nodeLimited = fixture('valid-minimal.json');
    nodeLimited.nodes = Array.from({ length: EDITOR_GRAPH_MAX_NODES + 1 }, (_, index) => ({
      ...nodeLimited.nodes[0],
      id: `node_${index}`,
    }));
    expect(codes(nodeLimited)).toEqual(['GRAPH_NODE_LIMIT_EXCEEDED']);

    const edgeLimited = fixture('valid-minimal.json');
    edgeLimited.edges = Array.from({ length: EDITOR_GRAPH_MAX_EDGES + 1 }, (_, index) => ({
      ...edgeLimited.edges[0],
      id: `edge_${index}`,
    }));
    expect(codes(edgeLimited)).toEqual(['GRAPH_EDGE_LIMIT_EXCEEDED']);
  });

  it('caps diagnostics and marks the response as truncated', () => {
    const graph = fixture('valid-minimal.json');
    graph.nodes.push(
      ...Array.from({ length: EDITOR_GRAPH_MAX_DIAGNOSTICS + 1 }, (_, index) => ({
        id: `unreachable_${index}`,
        type: 'flow.delay',
        config: {},
        bindings: {},
        errorPolicy: 'STOP' as const,
        editor: { x: index, y: 0 },
      })),
    );

    const result = buildValidationOutput({ errors: validateEditorGraphTopology(graph) });

    expect(result.errors).toHaveLength(EDITOR_GRAPH_MAX_DIAGNOSTICS);
    expect(result.truncated).toBe(true);
    expect(result.errors.every(({ code }) => code === 'NODE_UNREACHABLE')).toBe(true);
  });

  it('validates active node types and source ports against the supplied catalog', () => {
    const graph = fixture('valid-minimal.json');
    graph.edges[0].sourcePort = 'unknown';

    const diagnostics = validateEditorGraphCatalog(graph, [definition('flow.start', ['success'])]);

    expect(diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['EDGE_SOURCE_PORT_NOT_FOUND', 'NODE_TYPE_NOT_ACTIVE']),
    );
  });

  it.each([
    [{}, 'requiredValue'],
    [{ requiredValue: 1.5 }, 'requiredValue'],
    [{ requiredValue: 11 }, 'requiredValue'],
    [{ requiredValue: 5, name: 'wrong' }, 'name'],
    [{ requiredValue: 5, name: 'ABC', enabled: 'yes' }, 'enabled'],
    [{ requiredValue: 5, name: 'ABC', extra: true }, 'extra'],
    [{ requiredValue: 5, '': true }, ''],
  ])('reports invalid config at the field path', (config, invalidField) => {
    const graph = fixture('valid-minimal.json');
    graph.nodes.splice(1, 0, {
      id: 'configured_01',
      type: 'test.config',
      config,
      bindings: {},
      errorPolicy: 'STOP',
      editor: { x: 1, y: 1 },
    });
    const configSchema: WorkflowNodeDefinitionType['configSchema'] = {
      type: 'object',
      properties: {
        requiredValue: { type: 'integer', minimum: 1, maximum: 10 },
        name: { type: 'string', minLength: 2, maxLength: 4, pattern: '^[A-Z]+$' },
        enabled: { type: 'boolean' },
      },
      required: ['requiredValue'],
      additionalProperties: false,
    };

    const diagnostics = validateEditorGraphCatalog(graph, [
      definition('flow.start', ['success']),
      definition('flow.end', []),
      definition('test.config', ['success'], configSchema),
    ]);

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'NODE_CONFIG_INVALID',
        nodeId: 'configured_01',
        path: ['nodes', 1, 'config', invalidField],
      }),
    );
  });
});
