import fs from 'node:fs';
import path from 'node:path';
import {
  EditorGraph,
  ValidateEditorGraphInput,
  WorkflowValidationOutput,
} from '../workflow-validation.model.ts';

function fixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8'));
}

describe('Workflow Validation contracts', () => {
  it('accepts the strict minimal graph fixture', () => {
    expect(ValidateEditorGraphInput.safeParse(fixture('valid-minimal.json')).success).toBe(true);
  });

  it('accepts an unsupported positive schema version for semantic validation', () => {
    const input = fixture('valid-minimal.json') as {
      editorGraph: { schemaVersion: number };
    };
    input.editorGraph.schemaVersion = 2;

    expect(ValidateEditorGraphInput.safeParse(input).success).toBe(true);
  });

  it('keeps graph contract failures inside the validation engine', () => {
    const missingVersion = fixture('valid-minimal.json') as {
      editorGraph: Record<string, unknown>;
    };
    delete missingVersion.editorGraph.schemaVersion;

    const nonIntegerVersion = fixture('valid-minimal.json') as {
      editorGraph: Record<string, unknown>;
    };
    nonIntegerVersion.editorGraph.schemaVersion = 1.5;

    const unknownField = fixture('valid-minimal.json') as {
      editorGraph: Record<string, unknown>;
    };
    unknownField.editorGraph.unknown = true;

    expect(ValidateEditorGraphInput.safeParse(missingVersion).success).toBe(true);
    expect(ValidateEditorGraphInput.safeParse(nonIntegerVersion).success).toBe(true);
    expect(ValidateEditorGraphInput.safeParse(unknownField).success).toBe(true);
    expect(EditorGraph.safeParse(missingVersion.editorGraph).success).toBe(false);
    expect(EditorGraph.safeParse(nonIntegerVersion.editorGraph).success).toBe(false);
    expect(EditorGraph.safeParse(unknownField.editorGraph).success).toBe(false);
  });

  it('passes JSON-safe graph contract errors to the validation engine', () => {
    const invalid = fixture('valid-minimal.json') as {
      editorGraph: {
        entryNodeId: string;
        nodes: Array<Record<string, unknown>>;
      };
    };
    invalid.editorGraph.entryNodeId = ' '.repeat(2);
    invalid.editorGraph.nodes[0] = {
      ...invalid.editorGraph.nodes[0],
      type: 'Start',
      config: [],
      editor: { x: 0, y: 0 },
    };

    expect(ValidateEditorGraphInput.safeParse(invalid).success).toBe(true);
    expect(EditorGraph.safeParse(invalid.editorGraph).success).toBe(false);
  });

  it('rejects values that cannot cross JSON transport', () => {
    const invalid = fixture('valid-minimal.json') as {
      editorGraph: { nodes: Array<Record<string, unknown>> };
    };
    invalid.editorGraph.nodes[0].config = { value: Number.POSITIVE_INFINITY };

    expect(ValidateEditorGraphInput.safeParse(invalid).success).toBe(false);
  });

  it('rejects malformed outer envelopes', () => {
    expect(ValidateEditorGraphInput.safeParse({}).success).toBe(false);
    expect(ValidateEditorGraphInput.safeParse({ editorGraph: [] }).success).toBe(false);
    expect(ValidateEditorGraphInput.safeParse({ editorGraph: {}, unexpected: true }).success).toBe(
      false,
    );
  });

  it('accepts the declared validation response contract', () => {
    expect(
      WorkflowValidationOutput.safeParse({
        status: 'INVALID',
        errors: [
          {
            code: 'EDGE_TARGET_NODE_NOT_FOUND',
            message: 'Edge target node does not exist',
            edgeId: 'edge_01',
            nodeId: 'missing_node',
            path: ['edges', 0, 'targetNodeId'],
          },
        ],
        warnings: [],
        truncated: false,
      }).success,
    ).toBe(true);
  });
});
