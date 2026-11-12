import { z } from 'zod';
import {
  NODE_TYPE_MAX_LENGTH,
  NODE_TYPE_PATTERN,
  MAX_NODE_TIMEOUT_MS,
  NodeErrorPolicy,
} from '../node-catalog/node-catalog.constant.ts';
import {
  NodeDefinitionContract,
  NodeObjectSchema,
  NodeTargetingContract,
} from '../node-catalog/node-definition.model.ts';
import {
  EDITOR_GRAPH_IDENTIFIER_MAX_LENGTH,
  WorkflowValidationDiagnosticCode,
  WorkflowValidationStatus,
  WorkflowBindingKind,
  WORKFLOW_NODE_MAX_ATTEMPTS,
  WORKFLOW_NODE_MAX_RETRY_DELAY_MS,
} from '../../shared/constants/workflow-validation.constant.ts';

// Node IDs are Studio-local identifiers, not database UUIDs, so they only need stable bounded text.
const EditorGraphIdentifier = z.string().trim().min(1).max(EDITOR_GRAPH_IDENTIFIER_MAX_LENGTH);

// z.json() excludes functions, undefined, NaN, and other values that cannot cross JSON transport.
const EditorGraphJsonObject = z.record(z.string(), z.json());
const WorkflowFieldName = z.string().regex(/^[a-z][a-zA-Z0-9]{0,99}$/);
const WorkflowVariableName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/);

export const EditorGraphBinding = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal(WorkflowBindingKind.LITERAL),
    value: z.union([z.string(), z.number().int().safe(), z.boolean()]),
  }),
  z.strictObject({
    kind: z.literal(WorkflowBindingKind.WORKFLOW_INPUT),
    inputName: WorkflowFieldName,
  }),
  z.strictObject({
    kind: z.literal(WorkflowBindingKind.NODE_OUTPUT),
    nodeId: EditorGraphIdentifier,
    field: WorkflowFieldName,
  }),
  z.strictObject({
    kind: z.literal(WorkflowBindingKind.FLOW_VARIABLE),
    name: WorkflowVariableName,
  }),
  z.strictObject({
    kind: z.literal(WorkflowBindingKind.GLOBAL_VARIABLE),
    name: WorkflowVariableName,
  }),
]);

export const EditorGraphRetryPolicy = z
  .object({
    maxAttempts: z.number().int().min(1).max(WORKFLOW_NODE_MAX_ATTEMPTS).optional(),
    delayMs: z.number().int().min(0).max(WORKFLOW_NODE_MAX_RETRY_DELAY_MS).optional(),
  })
  .strict();

// A node keeps static config separate from bindings. Only explicit Android targeting modes
// validate literal bindings here; other bindings remain opaque.
export const EditorGraphNode = z
  .object({
    id: EditorGraphIdentifier,
    type: z.string().trim().min(1).max(NODE_TYPE_MAX_LENGTH).regex(NODE_TYPE_PATTERN),
    config: EditorGraphJsonObject,
    bindings: EditorGraphJsonObject,
    timeoutMs: z.number().int().min(1).max(MAX_NODE_TIMEOUT_MS).optional(),
    retryPolicy: EditorGraphRetryPolicy.optional(),
    errorPolicy: z.enum([NodeErrorPolicy.STOP, NodeErrorPolicy.ERROR_BRANCH]),
    editor: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        label: z.string().min(1).nullable().optional(),
        description: z.string().min(1).nullable().optional(),
      })
      .strict(),
  })
  .strict();

export const EditorGraphEdge = z
  .object({
    id: EditorGraphIdentifier,
    sourceNodeId: EditorGraphIdentifier,
    sourcePort: EditorGraphIdentifier,
    targetNodeId: EditorGraphIdentifier,
  })
  .strict();

export const EditorGraph = z
  .object({
    // Accept any positive integer at transport time. The engine reports an unsupported version as
    // a normal diagnostic, allowing Studio to display it instead of receiving a generic 422.
    schemaVersion: z.number().int().positive().safe(),
    entryNodeId: EditorGraphIdentifier,
    nodes: z.array(EditorGraphNode),
    edges: z.array(EditorGraphEdge),
  })
  .strict();

export const ValidateEditorGraphInput = z
  .object({
    // The HTTP envelope only proves that a JSON object was supplied. The validation engine parses
    // the strict Editor Graph contract so graph-shape problems can be returned as 200 INVALID.
    editorGraph: EditorGraphJsonObject,
  })
  .strict();

/**
 * The small part of a Node Definition needed by the validation engine.
 * Include field schemas for typed authoring bindings.
 */
export const WorkflowNodeDefinition = z
  .object({
    type: NodeDefinitionContract.shape.type,
    configSchema: NodeObjectSchema,
    inputSchema: NodeObjectSchema.optional(),
    outputSchema: NodeObjectSchema.optional(),
    outputPorts: NodeDefinitionContract.shape.outputPorts,
    editorHints: z
      .object({
        targeting: NodeTargetingContract.optional(),
      })
      .passthrough()
      .optional(),
  })
  .strict();

const WorkflowValidationDiagnosticPathSegment = z.union([
  z.string(),
  z.number().int().nonnegative(),
]);

export const WorkflowValidationDiagnostic = z
  .object({
    code: z.enum(WorkflowValidationDiagnosticCode),
    message: z.string().min(1),
    nodeId: EditorGraphIdentifier.optional(),
    edgeId: EditorGraphIdentifier.optional(),
    path: z.array(WorkflowValidationDiagnosticPathSegment),
  })
  .strict();

export const WorkflowValidationOutput = z
  .object({
    // Invalid user-authored content is represented here, not by throwing an HTTP exception.
    status: z.enum(WorkflowValidationStatus),
    errors: z.array(WorkflowValidationDiagnostic),
    warnings: z.array(WorkflowValidationDiagnostic),
    truncated: z.boolean(),
  })
  .strict();

export type EditorGraphType = z.infer<typeof EditorGraph>;
export type EditorGraphBindingType = z.infer<typeof EditorGraphBinding>;
export type ValidateEditorGraphInputType = z.infer<typeof ValidateEditorGraphInput>;
export type WorkflowNodeDefinitionType = z.infer<typeof WorkflowNodeDefinition>;
export type WorkflowValidationDiagnosticType = z.infer<typeof WorkflowValidationDiagnostic>;
export type WorkflowValidationOutputType = z.infer<typeof WorkflowValidationOutput>;
