import {
  EDITOR_GRAPH_MAX_DIAGNOSTICS,
  EDITOR_GRAPH_MAX_EDGES,
  EDITOR_GRAPH_MAX_NODES,
  EDITOR_GRAPH_SCHEMA_VERSION,
  WORKFLOW_VALIDATION_DIAGNOSTIC_MESSAGES,
  WorkflowValidationDiagnosticCode,
  WorkflowValidationStatus,
  type WorkflowValidationDiagnosticCodeType,
} from '../../../shared/constants/workflow-validation.constant.ts';
import type {
  EditorGraphType,
  WorkflowNodeDefinitionType,
  WorkflowValidationDiagnosticType,
  WorkflowValidationOutputType,
} from '../workflow-validation.model.ts';
import { validateNodeConfig } from './node-config.validator.ts';

type IndexedEdge = EditorGraphType['edges'][number] & { index: number };

function diagnostic(
  code: WorkflowValidationDiagnosticCodeType,
  path: Array<string | number>,
  references: Pick<WorkflowValidationDiagnosticType, 'nodeId' | 'edgeId'> = {},
): WorkflowValidationDiagnosticType {
  // Keep diagnostic creation in one place so every rule returns the same safe, public message
  // shape. Values from config/bindings are deliberately never copied into the response.
  return {
    code,
    message: WORKFLOW_VALIDATION_DIAGNOSTIC_MESSAGES[code],
    ...references,
    path,
  };
}

/** Converts strict Editor Graph parse failures into safe workflow diagnostics. */
export function buildEditorGraphContractErrors(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>,
): WorkflowValidationDiagnosticType[] {
  return issues.map(({ path }) =>
    diagnostic(
      WorkflowValidationDiagnosticCode.EDITOR_GRAPH_CONTRACT_INVALID,
      path.map((segment) =>
        typeof segment === 'string' || typeof segment === 'number' ? segment : String(segment),
      ),
    ),
  );
}

function compareDiagnostics(
  left: WorkflowValidationDiagnosticType,
  right: WorkflowValidationDiagnosticType,
): number {
  // Validation traversals may discover the same problems in a different order after an internal
  // refactor. Sorting by stable public fields keeps API responses and Studio rendering predictable.
  return (
    left.code.localeCompare(right.code) ||
    (left.nodeId ?? '').localeCompare(right.nodeId ?? '') ||
    (left.edgeId ?? '').localeCompare(right.edgeId ?? '') ||
    JSON.stringify(left.path).localeCompare(JSON.stringify(right.path))
  );
}

/** Sorts, caps, and turns raw diagnostics into the stable API response. */
export function buildValidationOutput({
  errors,
  warnings = [],
}: {
  errors: WorkflowValidationDiagnosticType[];
  warnings?: WorkflowValidationDiagnosticType[];
}): WorkflowValidationOutputType {
  // Errors consume the response budget before warnings. A caller must never receive a warning
  // while a more important error was hidden only because the diagnostic cap was reached.
  const sortedErrors = [...errors].sort(compareDiagnostics);
  const sortedWarnings = [...warnings].sort(compareDiagnostics);
  const diagnosticCount = sortedErrors.length + sortedWarnings.length;
  const cappedErrors = sortedErrors.slice(0, EDITOR_GRAPH_MAX_DIAGNOSTICS);
  const warningCapacity = EDITOR_GRAPH_MAX_DIAGNOSTICS - cappedErrors.length;
  const cappedWarnings = sortedWarnings.slice(0, warningCapacity);

  return {
    status:
      cappedErrors.length > 0
        ? WorkflowValidationStatus.INVALID
        : cappedWarnings.length > 0
          ? WorkflowValidationStatus.VALID_WITH_WARNINGS
          : WorkflowValidationStatus.VALID,
    errors: cappedErrors,
    warnings: cappedWarnings,
    truncated: diagnosticCount > EDITOR_GRAPH_MAX_DIAGNOSTICS,
  };
}

export function hasGraphLimitError(diagnostics: WorkflowValidationDiagnosticType[]): boolean {
  // Oversized graphs stop before catalog loading and graph traversal. Other topology errors do not
  // stop the pipeline because combining them with catalog errors gives Studio a better error batch.
  return diagnostics.some(
    ({ code }) =>
      code === WorkflowValidationDiagnosticCode.GRAPH_NODE_LIMIT_EXCEEDED ||
      code === WorkflowValidationDiagnosticCode.GRAPH_EDGE_LIMIT_EXCEEDED,
  );
}

/** Validates graph structure against itself. This pure function never touches the database. */
export function validateEditorGraphTopology(
  graph: EditorGraphType,
): WorkflowValidationDiagnosticType[] {
  const errors: WorkflowValidationDiagnosticType[] = [];

  // Pass 1 - enforce hard work bounds before allocating indexes or walking the graph. These checks
  // protect both the API and the future local validator from unbounded CPU and memory use.
  if (graph.nodes.length > EDITOR_GRAPH_MAX_NODES) {
    errors.push(diagnostic(WorkflowValidationDiagnosticCode.GRAPH_NODE_LIMIT_EXCEEDED, ['nodes']));
  }
  if (graph.edges.length > EDITOR_GRAPH_MAX_EDGES) {
    errors.push(diagnostic(WorkflowValidationDiagnosticCode.GRAPH_EDGE_LIMIT_EXCEEDED, ['edges']));
  }
  if (errors.length > 0) {
    return errors;
  }

  // Pass 2 - the transport shape may parse correctly while using a graph language this engine does
  // not understand. Report that as invalid content instead of interpreting it with the wrong rules.
  if (graph.schemaVersion !== EDITOR_GRAPH_SCHEMA_VERSION) {
    errors.push(
      diagnostic(WorkflowValidationDiagnosticCode.GRAPH_SCHEMA_VERSION_UNSUPPORTED, [
        'schemaVersion',
      ]),
    );
  }

  // Pass 3 - build O(1) lookup indexes and report duplicate identities. The first node remains in
  // nodeById; keeping one deterministic representative lets later passes continue without throwing.
  const nodeById = new Map<string, EditorGraphType['nodes'][number]>();
  graph.nodes.forEach((node, index) => {
    if (nodeById.has(node.id)) {
      errors.push(
        diagnostic(WorkflowValidationDiagnosticCode.NODE_ID_DUPLICATED, ['nodes', index, 'id'], {
          nodeId: node.id,
        }),
      );
      return;
    }
    nodeById.set(node.id, node);
  });

  const edgeIds = new Set<string>();
  graph.edges.forEach((edge, index) => {
    if (edgeIds.has(edge.id)) {
      errors.push(
        diagnostic(WorkflowValidationDiagnosticCode.EDGE_ID_DUPLICATED, ['edges', index, 'id'], {
          edgeId: edge.id,
        }),
      );
      return;
    }
    edgeIds.add(edge.id);
  });

  // Pass 4 - a workflow must have one unambiguous execution entry. entryNodeId must point to that
  // exact flow.start node; merely pointing to any existing node is not sufficient.
  const startNodes = graph.nodes.filter((node) => node.type === 'flow.start');
  if (startNodes.length !== 1) {
    errors.push(diagnostic(WorkflowValidationDiagnosticCode.START_NODE_COUNT_INVALID, ['nodes']));
  }
  const startNode = startNodes.length === 1 ? startNodes[0] : undefined;
  if (!startNode || graph.entryNodeId !== startNode.id) {
    errors.push(
      diagnostic(WorkflowValidationDiagnosticCode.ENTRY_NODE_INVALID, ['entryNodeId'], {
        nodeId: graph.entryNodeId,
      }),
    );
  }

  // Pass 5 - validate edge endpoints while building the adjacency list used by reachability and
  // cycle detection. Only edges with two existing endpoints enter the list, so later traversals do
  // not need null checks and cannot accidentally invent missing nodes.
  const adjacency = new Map<string, IndexedEdge[]>();
  nodeById.forEach((_node, nodeId) => adjacency.set(nodeId, []));

  graph.edges.forEach((edge, index) => {
    const sourceNode = nodeById.get(edge.sourceNodeId);
    const targetNode = nodeById.get(edge.targetNodeId);
    if (!sourceNode) {
      errors.push(
        diagnostic(
          WorkflowValidationDiagnosticCode.EDGE_SOURCE_NODE_NOT_FOUND,
          ['edges', index, 'sourceNodeId'],
          { edgeId: edge.id, nodeId: edge.sourceNodeId },
        ),
      );
    }
    if (!targetNode) {
      errors.push(
        diagnostic(
          WorkflowValidationDiagnosticCode.EDGE_TARGET_NODE_NOT_FOUND,
          ['edges', index, 'targetNodeId'],
          { edgeId: edge.id, nodeId: edge.targetNodeId },
        ),
      );
    }
    // flow.end is terminal regardless of whether the target endpoint is otherwise valid.
    if (sourceNode?.type === 'flow.end') {
      errors.push(
        diagnostic(
          WorkflowValidationDiagnosticCode.END_NODE_HAS_OUTGOING_EDGE,
          ['edges', index, 'sourceNodeId'],
          { edgeId: edge.id, nodeId: sourceNode.id },
        ),
      );
    }
    if (sourceNode && targetNode) {
      adjacency.get(sourceNode.id)?.push({ ...edge, index });
    }
  });

  // Pass 6 - walk outward from the single Start node. When Start is missing or ambiguous, no node is
  // considered reachable; that exposes the downstream consequence instead of choosing one Start.
  const reachable = new Set<string>();
  if (startNode) {
    const pending = [startNode.id];
    while (pending.length > 0) {
      const nodeId = pending.pop();
      if (!nodeId || reachable.has(nodeId)) {
        continue;
      }
      reachable.add(nodeId);
      adjacency.get(nodeId)?.forEach((edge) => pending.push(edge.targetNodeId));
    }
  }

  graph.nodes.forEach((node, index) => {
    if (!reachable.has(node.id)) {
      errors.push(
        diagnostic(WorkflowValidationDiagnosticCode.NODE_UNREACHABLE, ['nodes', index], {
          nodeId: node.id,
        }),
      );
    }
  });

  // Having an End node somewhere is not enough: at least one End must be on an executable path from
  // Start. This diagnostic is separate from NODE_UNREACHABLE so Studio can explain the root issue.
  if (!graph.nodes.some((node) => node.type === 'flow.end' && reachable.has(node.id))) {
    errors.push(diagnostic(WorkflowValidationDiagnosticCode.END_NODE_UNREACHABLE, ['nodes']));
  }

  // Pass 7 - three-color DFS reports each back-edge into the current recursion path. Any directed
  // cycle is uncontrolled in this MVP; explicit loop nodes/semantics will be handled in a later phase.
  const visitState = new Map<string, 'VISITING' | 'VISITED'>();
  const visit = (nodeId: string) => {
    visitState.set(nodeId, 'VISITING');
    adjacency.get(nodeId)?.forEach((edge) => {
      const targetState = visitState.get(edge.targetNodeId);
      if (targetState === 'VISITING') {
        errors.push(
          diagnostic(WorkflowValidationDiagnosticCode.GRAPH_CYCLE_DETECTED, ['edges', edge.index], {
            edgeId: edge.id,
            nodeId: edge.targetNodeId,
          }),
        );
      } else if (!targetState) {
        visit(edge.targetNodeId);
      }
    });
    visitState.set(nodeId, 'VISITED');
  };

  nodeById.forEach((_node, nodeId) => {
    if (!visitState.has(nodeId)) {
      visit(nodeId);
    }
  });

  return errors;
}

/** Compares node types, source ports, and static config with one active catalog snapshot. */
export function validateEditorGraphCatalog(
  graph: EditorGraphType,
  definitions: WorkflowNodeDefinitionType[],
): WorkflowValidationDiagnosticType[] {
  const errors: WorkflowValidationDiagnosticType[] = [];

  // The service loaded all distinct requested types in one query. A missing map entry therefore
  // means that the type is unknown, disabled, or deleted in the current catalog snapshot.
  const definitionByType = new Map(definitions.map((definition) => [definition.type, definition]));

  // Catalog pass 1 - validate the node type first. Config cannot be interpreted safely when its
  // system-owned definition is unavailable, so that node stops here instead of emitting guesses.
  graph.nodes.forEach((node, index) => {
    const definition = definitionByType.get(node.type);
    if (!definition) {
      errors.push(
        diagnostic(
          WorkflowValidationDiagnosticCode.NODE_TYPE_NOT_ACTIVE,
          ['nodes', index, 'type'],
          {
            nodeId: node.id,
          },
        ),
      );
      return;
    }
    errors.push(...validateNodeConfig(node, index, definition.configSchema));
  });

  // Catalog pass 2 - verify the named output port against the source node definition. Endpoint
  // existence was already reported by topology validation, so missing sources are skipped here.
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  graph.edges.forEach((edge, index) => {
    const sourceNode = nodeById.get(edge.sourceNodeId);
    const sourceDefinition = sourceNode ? definitionByType.get(sourceNode.type) : undefined;
    if (
      sourceNode &&
      sourceDefinition &&
      !sourceDefinition.outputPorts.ports.some(({ key }) => key === edge.sourcePort)
    ) {
      errors.push(
        diagnostic(
          WorkflowValidationDiagnosticCode.EDGE_SOURCE_PORT_NOT_FOUND,
          ['edges', index, 'sourcePort'],
          { edgeId: edge.id, nodeId: sourceNode.id },
        ),
      );
    }
  });

  return errors;
}
