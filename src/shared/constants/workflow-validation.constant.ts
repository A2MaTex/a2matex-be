// Editor Graph version understood by this engine. This versions the Studio document contract; it
// is unrelated to the removed per-node definition version.
export const EDITOR_GRAPH_SCHEMA_VERSION = 1;

// Resource bounds are shared by transport contracts and the engine so they cannot drift apart.
export const EDITOR_GRAPH_IDENTIFIER_MAX_LENGTH = 100;
export const EDITOR_GRAPH_MAX_NODES = 500;
export const EDITOR_GRAPH_MAX_EDGES = 1_000;
export const EDITOR_GRAPH_MAX_DIAGNOSTICS = 100;
export const EDITOR_GRAPH_MAX_CONTENT_BYTES = 1_048_576;

export const WorkflowValidationStatus = {
  INVALID: 'INVALID',
  VALID_WITH_WARNINGS: 'VALID_WITH_WARNINGS',
  VALID: 'VALID',
} as const;

// Diagnostic codes are stable machine-readable API values. Studio should branch on these codes,
// not on the English messages below, which remain safe human-readable explanations.
export const WorkflowValidationDiagnosticCode = {
  EDITOR_GRAPH_CONTRACT_INVALID: 'EDITOR_GRAPH_CONTRACT_INVALID',
  GRAPH_SCHEMA_VERSION_UNSUPPORTED: 'GRAPH_SCHEMA_VERSION_UNSUPPORTED',
  NODE_ID_DUPLICATED: 'NODE_ID_DUPLICATED',
  EDGE_ID_DUPLICATED: 'EDGE_ID_DUPLICATED',
  START_NODE_COUNT_INVALID: 'START_NODE_COUNT_INVALID',
  ENTRY_NODE_INVALID: 'ENTRY_NODE_INVALID',
  END_NODE_UNREACHABLE: 'END_NODE_UNREACHABLE',
  EDGE_SOURCE_NODE_NOT_FOUND: 'EDGE_SOURCE_NODE_NOT_FOUND',
  EDGE_TARGET_NODE_NOT_FOUND: 'EDGE_TARGET_NODE_NOT_FOUND',
  EDGE_SOURCE_PORT_NOT_FOUND: 'EDGE_SOURCE_PORT_NOT_FOUND',
  END_NODE_HAS_OUTGOING_EDGE: 'END_NODE_HAS_OUTGOING_EDGE',
  NODE_UNREACHABLE: 'NODE_UNREACHABLE',
  GRAPH_CYCLE_DETECTED: 'GRAPH_CYCLE_DETECTED',
  NODE_TYPE_NOT_ACTIVE: 'NODE_TYPE_NOT_ACTIVE',
  NODE_CONFIG_INVALID: 'NODE_CONFIG_INVALID',
  GRAPH_NODE_LIMIT_EXCEEDED: 'GRAPH_NODE_LIMIT_EXCEEDED',
  GRAPH_EDGE_LIMIT_EXCEEDED: 'GRAPH_EDGE_LIMIT_EXCEEDED',
} as const;

export type WorkflowValidationDiagnosticCodeType =
  (typeof WorkflowValidationDiagnosticCode)[keyof typeof WorkflowValidationDiagnosticCode];

export const WORKFLOW_VALIDATION_DIAGNOSTIC_MESSAGES: Record<
  WorkflowValidationDiagnosticCodeType,
  string
> = {
  EDITOR_GRAPH_CONTRACT_INVALID: 'Editor Graph does not match the required contract',
  GRAPH_SCHEMA_VERSION_UNSUPPORTED: 'Editor Graph schema version is not supported',
  NODE_ID_DUPLICATED: 'Node ID must be unique',
  EDGE_ID_DUPLICATED: 'Edge ID must be unique',
  START_NODE_COUNT_INVALID: 'Graph must contain exactly one Start node',
  ENTRY_NODE_INVALID: 'Entry node must reference the single Start node',
  END_NODE_UNREACHABLE: 'Graph must contain at least one End node reachable from Start',
  EDGE_SOURCE_NODE_NOT_FOUND: 'Edge source node does not exist',
  EDGE_TARGET_NODE_NOT_FOUND: 'Edge target node does not exist',
  EDGE_SOURCE_PORT_NOT_FOUND: 'Edge source port does not exist on the source node definition',
  END_NODE_HAS_OUTGOING_EDGE: 'End node cannot have outgoing edges',
  NODE_UNREACHABLE: 'Node is not reachable from Start',
  GRAPH_CYCLE_DETECTED: 'Graph contains an uncontrolled cycle',
  NODE_TYPE_NOT_ACTIVE: 'Node type does not exist in the active Node Catalog',
  NODE_CONFIG_INVALID: 'Node configuration does not match its definition',
  GRAPH_NODE_LIMIT_EXCEEDED: 'Graph exceeds the maximum node count',
  GRAPH_EDGE_LIMIT_EXCEEDED: 'Graph exceeds the maximum edge count',
};
