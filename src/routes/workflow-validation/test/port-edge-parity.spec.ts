import { readFileSync } from 'node:fs';
import { BASIC_NODE_DEFINITIONS } from '../../node-catalog/definitions/basic-node-definitions.ts';
import { WorkflowCompilerService } from '../../workflow-compiler/workflow-compiler.service.ts';
import type { WorkflowCompilerRepo } from '../../workflow-compiler/workflow-compiler.repo.ts';
import {
  buildValidationOutput,
  validateEditorGraphCatalog,
  validateEditorGraphTopology,
} from '../validator/editor-graph.validator.ts';
import { EditorGraph } from '../workflow-validation.model.ts';

const cases = JSON.parse(
  readFileSync(new URL('./fixtures/port-edge-parity.json', import.meta.url), 'utf8'),
) as Array<{
  name: string;
  editorGraph: unknown;
  inputSchema: unknown;
  validation: unknown;
  runtimeIr: unknown;
}>;

describe('port edge count parity', () => {
  const compiler = new WorkflowCompilerService({} as WorkflowCompilerRepo);

  it.each(cases)('$name', ({ editorGraph, inputSchema, validation, runtimeIr }) => {
    const graph = EditorGraph.parse(editorGraph);
    const errors = [
      ...validateEditorGraphTopology(graph),
      ...validateEditorGraphCatalog(graph, BASIC_NODE_DEFINITIONS),
    ];
    expect(buildValidationOutput({ errors })).toEqual(validation);
    const result = compiler.compileWorkflow(graph, inputSchema, BASIC_NODE_DEFINITIONS);
    expect(result.validation).toEqual(validation);
    expect(result.success ? result.runtimeIr : null).toEqual(runtimeIr);
  });
});
