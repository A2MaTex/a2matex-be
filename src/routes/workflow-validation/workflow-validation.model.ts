import { z } from 'zod';
import {
  NODE_TYPE_MAX_LENGTH,
  NODE_TYPE_PATTERN,
  NodeErrorPolicy,
} from '../node-catalog/node-catalog.constant.ts';
import { NodeDefinitionContract, NodeObjectSchema } from '../node-catalog/node-definition.model.ts';
import {
  EDITOR_GRAPH_IDENTIFIER_MAX_LENGTH,
  WorkflowValidationDiagnosticCode,
  WorkflowValidationStatus,
} from '../../shared/constants/workflow-validation.constant.ts';

// Node IDs are Studio-local identifiers, not database UUIDs, so they only need stable bounded text.
const EditorGraphIdentifier = z.string().trim().min(1).max(EDITOR_GRAPH_IDENTIFIER_MAX_LENGTH);

// z.json() excludes functions, undefined, NaN, and other values that cannot cross JSON transport.
const EditorGraphJsonObject = z.record(z.string(), z.json());

// A node keeps static config separate from bindings. Phase 4 validates config only; bindings remain
// opaque until the binding/type phase can resolve workflow inputs and previous-node outputs.
export const EditorGraphNode = z
  .object({
    id: EditorGraphIdentifier,
    type: z.string().trim().min(1).max(NODE_TYPE_MAX_LENGTH).regex(NODE_TYPE_PATTERN),
    config: EditorGraphJsonObject,
    bindings: EditorGraphJsonObject,
    errorPolicy: z.enum([NodeErrorPolicy.STOP, NodeErrorPolicy.ERROR_BRANCH]),
    editor: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
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
 * Keeping this projection explicit prevents Runtime metadata, capabilities, and output schemas from
 * leaking into or accidentally becoming dependencies of Phase 4 validation.
 */
export const WorkflowNodeDefinition = z
  .object({
    type: NodeDefinitionContract.shape.type,
    configSchema: NodeObjectSchema,
    outputPorts: NodeDefinitionContract.shape.outputPorts,
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
export type ValidateEditorGraphInputType = z.infer<typeof ValidateEditorGraphInput>;
export type WorkflowNodeDefinitionType = z.infer<typeof WorkflowNodeDefinition>;
export type WorkflowValidationDiagnosticType = z.infer<typeof WorkflowValidationDiagnostic>;
export type WorkflowValidationOutputType = z.infer<typeof WorkflowValidationOutput>;
