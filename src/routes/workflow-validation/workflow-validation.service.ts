import { Inject, Injectable } from '@nestjs/common';
import {
  buildEditorGraphContractErrors,
  buildValidationOutput,
  hasGraphLimitError,
  validateEditorGraphCatalog,
  validateEditorGraphTopology,
} from './validator/editor-graph.validator.ts';
import { EDITOR_GRAPH_MAX_CONTENT_BYTES } from '../../shared/constants/workflow-validation.constant.ts';
import { EditorGraphPayloadTooLargeException } from './workflow-validation.error.ts';
import {
  EditorGraph,
  WorkflowNodeDefinition,
  type WorkflowValidationOutputType,
} from './workflow-validation.model.ts';
import { WorkflowValidationRepo } from './workflow-validation.repo.ts';

@Injectable()
export class WorkflowValidationService {
  constructor(
    @Inject(WorkflowValidationRepo)
    private readonly workflowValidationRepo: WorkflowValidationRepo,
  ) {}

  async validate(editorGraph: unknown): Promise<WorkflowValidationOutputType> {
    // Step 1: reject expensive oversized input before schema parsing, traversal, or catalog access.
    this.assertPayloadSize(editorGraph);

    // Step 2: parse the strict workflow contract inside the engine. Invalid user-authored graph
    // content is a successful validation operation and therefore returns 200 INVALID diagnostics.
    const parsedGraph = EditorGraph.safeParse(editorGraph);
    if (!parsedGraph.success) {
      return buildValidationOutput({
        errors: buildEditorGraphContractErrors(parsedGraph.error.issues),
      });
    }
    const graph = parsedGraph.data;

    // Step 3: run the database-free structural pass. Topology errors normally coexist with catalog
    // errors so Studio receives a useful batch, but graph-count violations stop the pipeline early.
    const topologyErrors = validateEditorGraphTopology(graph);
    if (hasGraphLimitError(topologyErrors)) {
      return buildValidationOutput({ errors: topologyErrors });
    }

    // Step 4: many node instances may share one type. Deduplication keeps the single catalog query
    // small and guarantees query count does not grow with repeated instances of the same node.
    const distinctNodeTypes = [...new Set(graph.nodes.map(({ type }) => type))];
    const storedDefinitions =
      await this.workflowValidationRepo.getActiveNodeDefinitions(distinctNodeTypes);

    // Database JSON is untyped at runtime. Parse the small engine-facing definition projection once
    // at this boundary so the pure validator never receives malformed system-owned definitions.
    const definitions = storedDefinitions.map((definition) =>
      WorkflowNodeDefinition.parse(definition),
    );

    // Step 5: compare the graph with the current active catalog snapshot, then merge both passes.
    // Result assembly owns sorting, diagnostic capping, truncation, and final status derivation.
    const catalogErrors = validateEditorGraphCatalog(graph, definitions);

    return buildValidationOutput({ errors: [...topologyErrors, ...catalogErrors] });
  }

  private assertPayloadSize(editorGraph: unknown): void {
    // The global JSON parser has a larger transport ceiling. This is the exact feature-level limit
    // for the Editor Graph itself, excluding the surrounding HTTP envelope.
    const serializedGraph = JSON.stringify(editorGraph);
    if (
      serializedGraph !== undefined &&
      Buffer.byteLength(serializedGraph, 'utf8') > EDITOR_GRAPH_MAX_CONTENT_BYTES
    ) {
      throw EditorGraphPayloadTooLargeException;
    }
  }
}
