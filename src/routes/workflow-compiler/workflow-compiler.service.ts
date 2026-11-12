import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { NodeDefinitionCatalogContract } from '../node-catalog/node-definition.model.ts';
import { ProjectNotFoundException } from '../project/project.error.ts';
import {
  WORKFLOW_NODE_DEFAULT_MAX_ATTEMPTS,
  WORKFLOW_NODE_DEFAULT_RETRY_DELAY_MS,
  WORKFLOW_VALIDATION_DIAGNOSTIC_MESSAGES,
  WorkflowBindingKind,
  WorkflowValidationDiagnosticCode,
} from '../../shared/constants/workflow-validation.constant.ts';
import {
  EditorGraph,
  EditorGraphBinding,
  WorkflowNodeDefinition,
  type EditorGraphBindingType,
  type EditorGraphType,
  type WorkflowValidationDiagnosticType,
} from '../workflow-validation/workflow-validation.model.ts';
import {
  buildEditorGraphContractErrors,
  buildValidationOutput,
  hasGraphLimitError,
  validateEditorGraphCatalog,
  validateEditorGraphTopology,
} from '../workflow-validation/validator/editor-graph.validator.ts';
import {
  RUNTIME_IR_FORMAT_VERSION,
  RUNTIME_IR_MAX_CONTENT_BYTES,
} from './workflow-compiler.constant.ts';
import {
  RuntimeIr,
  WorkflowInputSchema,
  type CompileProjectDraftOutputType,
  type RuntimeInputSourceType,
  type WorkflowCompileResult,
  type WorkflowInputSchemaType,
} from './workflow-compiler.model.ts';
import type { NodeDefinitionType } from '../node-catalog/node-definition.model.ts';
import { WorkflowCompilerRepo } from './workflow-compiler.repo.ts';

@Injectable()
export class WorkflowCompilerService {
  constructor(
    @Inject(WorkflowCompilerRepo) private readonly workflowCompilerRepo: WorkflowCompilerRepo,
  ) {}

  async compileProjectDraft(projectId: string): Promise<CompileProjectDraftOutputType> {
    const draft = await this.workflowCompilerRepo.getProjectDraft(projectId);
    if (!draft) {
      throw ProjectNotFoundException;
    }

    const parsedGraph = EditorGraph.safeParse(draft.editorGraph);
    const nodeTypes = parsedGraph.success
      ? [...new Set(parsedGraph.data.nodes.map(({ type }) => type))]
      : [];
    const storedDefinitions = await this.workflowCompilerRepo.getActiveNodeDefinitions(nodeTypes);
    const definitions = storedDefinitions.map(({ NodeDefinitionCapability, ...definition }) => ({
      ...definition,
      capabilities: NodeDefinitionCapability.map(({ Capability }) => Capability.code),
    }));

    const result = this.compileWorkflow(draft.editorGraph, draft.inputSchema, definitions);
    return result.success
      ? { ...result, sourceDraftVersion: draft.version }
      : { ...result, sourceDraftVersion: draft.version, runtimeIr: null };
  }

  compileWorkflow(
    editorGraph: unknown,
    inputSchema: unknown,
    nodeDefinitions: unknown,
  ): WorkflowCompileResult {
    const parsedGraph = EditorGraph.safeParse(editorGraph);
    const parsedInputSchema = WorkflowInputSchema.safeParse(inputSchema);
    const contractErrors = [
      ...(parsedGraph.success ? [] : buildEditorGraphContractErrors(parsedGraph.error.issues)),
      ...(parsedInputSchema.success
        ? []
        : parsedInputSchema.error.issues.map(({ path }) =>
            this.inputSchemaDiagnostic(
              path.map((segment) =>
                typeof segment === 'string' || typeof segment === 'number'
                  ? segment
                  : String(segment),
              ),
            ),
          )),
    ];
    if (!parsedGraph.success || !parsedInputSchema.success) {
      return { success: false, validation: buildValidationOutput({ errors: contractErrors }) };
    }

    // Definitions are system-owned input. A malformed or duplicate frozen manifest is an internal
    // defect and must fail loudly instead of being represented as publisher-authored diagnostics.
    const definitions = NodeDefinitionCatalogContract.parse(nodeDefinitions);
    const graph = parsedGraph.data;
    const topologyErrors = validateEditorGraphTopology(graph);
    if (hasGraphLimitError(topologyErrors)) {
      return { success: false, validation: buildValidationOutput({ errors: topologyErrors }) };
    }

    const validationDefinitions = definitions.map(
      ({ type, configSchema, inputSchema, outputSchema, outputPorts, editorHints }) =>
        WorkflowNodeDefinition.parse({
          type,
          configSchema,
          inputSchema,
          outputSchema,
          outputPorts,
          editorHints,
        }),
    );
    const catalogErrors = validateEditorGraphCatalog(
      graph,
      validationDefinitions,
      parsedInputSchema.data,
    );
    const validation = buildValidationOutput({ errors: [...topologyErrors, ...catalogErrors] });
    if (validation.errors.length > 0) {
      return { success: false, validation };
    }

    const runtimeIr = this.buildRuntimeIr(graph, parsedInputSchema.data, definitions);
    const serialized = JSON.stringify(runtimeIr);
    if (Buffer.byteLength(serialized, 'utf8') > RUNTIME_IR_MAX_CONTENT_BYTES) {
      return {
        success: false,
        validation: buildValidationOutput({
          errors: [
            this.diagnostic(WorkflowValidationDiagnosticCode.RUNTIME_IR_PAYLOAD_TOO_LARGE, []),
          ],
        }),
      };
    }

    return { success: true, runtimeIr, validation };
  }

  private buildRuntimeIr(
    graph: EditorGraphType,
    inputSchema: WorkflowInputSchemaType,
    definitions: NodeDefinitionType[],
  ) {
    const definitionByType = new Map(
      definitions.map((definition) => [definition.type, definition]),
    );
    const requiredCapabilities: string[] = [];
    const seenCapabilities = new Set<string>();

    const nodes = graph.nodes.map((node) => {
      const definition = definitionByType.get(node.type);
      if (!definition) {
        throw new Error('Validated workflow references an unavailable node definition');
      }
      for (const capability of definition.capabilities) {
        if (seenCapabilities.has(capability)) continue;
        seenCapabilities.add(capability);
        requiredCapabilities.push(capability);
      }
      return {
        id: node.id,
        type: node.type,
        runtimeHandler: definition.runtimeHandler,
        config: node.config,
        inputs: Object.fromEntries(
          Object.entries(node.bindings).map(([field, rawBinding]) => [
            field,
            this.compileBinding(EditorGraphBinding.parse(rawBinding)),
          ]),
        ),
        timeoutMs: node.timeoutMs ?? definition.defaultTimeoutMs,
        retryPolicy: {
          maxAttempts: node.retryPolicy?.maxAttempts ?? WORKFLOW_NODE_DEFAULT_MAX_ATTEMPTS,
          delayMs: node.retryPolicy?.delayMs ?? WORKFLOW_NODE_DEFAULT_RETRY_DELAY_MS,
        },
        errorPolicy: node.errorPolicy,
      };
    });

    return RuntimeIr.parse({
      formatVersion: RUNTIME_IR_FORMAT_VERSION,
      minimumRuntimeVersion: this.highestMinimumRuntimeVersion(definitions, graph),
      metadata: { sourceGraphSchemaVersion: graph.schemaVersion },
      entryNodeId: graph.entryNodeId,
      inputSchema,
      nodes,
      edges: graph.edges,
      requiredCapabilities,
    });
  }

  private compileBinding(binding: EditorGraphBindingType): RuntimeInputSourceType {
    switch (binding.kind) {
      case WorkflowBindingKind.LITERAL:
        return { source: binding.kind, value: binding.value };
      case WorkflowBindingKind.WORKFLOW_INPUT:
        return { source: binding.kind, inputName: binding.inputName };
      case WorkflowBindingKind.NODE_OUTPUT:
        return { source: binding.kind, nodeId: binding.nodeId, field: binding.field };
      case WorkflowBindingKind.FLOW_VARIABLE:
      case WorkflowBindingKind.GLOBAL_VARIABLE:
        return { source: binding.kind, name: binding.name };
    }
  }

  private highestMinimumRuntimeVersion(
    definitions: NodeDefinitionType[],
    graph: EditorGraphType,
  ): string {
    const versions = new Map(
      definitions.map(({ type, minimumRuntimeVersion }) => [type, minimumRuntimeVersion]),
    );
    return graph.nodes.reduce((highest, { type }) => {
      const candidate = versions.get(type);
      if (!candidate) throw new Error('Validated workflow references an unavailable node version');
      return this.compareVersions(candidate, highest) > 0 ? candidate : highest;
    }, '0.0.0');
  }

  private compareVersions(left: string, right: string): number {
    const leftParts = left.split('.').map(Number);
    const rightParts = right.split('.').map(Number);
    for (let index = 0; index < 3; index++) {
      const difference = leftParts[index] - rightParts[index];
      if (difference !== 0) return difference;
    }
    return 0;
  }

  private inputSchemaDiagnostic(path: Array<string | number>): WorkflowValidationDiagnosticType {
    return this.diagnostic(WorkflowValidationDiagnosticCode.WORKFLOW_INPUT_SCHEMA_INVALID, [
      'inputSchema',
      ...path,
    ]);
  }

  private diagnostic(
    code: keyof typeof WORKFLOW_VALIDATION_DIAGNOSTIC_MESSAGES,
    path: Array<string | number>,
  ): WorkflowValidationDiagnosticType {
    return { code, message: WORKFLOW_VALIDATION_DIAGNOSTIC_MESSAGES[code], path };
  }
}
