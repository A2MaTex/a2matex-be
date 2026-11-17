import { z } from 'zod';
import {
  MAX_NODE_TIMEOUT_MS,
  NODE_CAPABILITY_CODE_MAX_LENGTH,
  NODE_CAPABILITY_CODE_PATTERN,
  NODE_RUNTIME_HANDLER_MAX_LENGTH,
  NODE_RUNTIME_HANDLER_PATTERN,
  NODE_TYPE_MAX_LENGTH,
  NODE_TYPE_PATTERN,
  NodeErrorPolicy,
  STRICT_SEMANTIC_VERSION_PATTERN,
} from '../node-catalog/node-catalog.constant.ts';
import {
  EDITOR_GRAPH_IDENTIFIER_MAX_LENGTH,
  EDITOR_GRAPH_MAX_EDGES,
  EDITOR_GRAPH_MAX_NODES,
  WORKFLOW_NODE_MAX_ATTEMPTS,
  WORKFLOW_NODE_MAX_RETRY_DELAY_MS,
  WorkflowBindingKind,
} from '../../shared/constants/workflow-validation.constant.ts';
import {
  RUNTIME_IR_FORMAT_VERSION,
  WORKFLOW_INPUT_MAX_FIELDS,
  WORKFLOW_INPUT_MAX_STRING_LENGTH,
} from './workflow-compiler.constant.ts';
import {
  WorkflowValidationOutput,
  type WorkflowValidationOutputType,
} from '../workflow-validation/workflow-validation.model.ts';

const RuntimeIdentifier = z.string().trim().min(1).max(EDITOR_GRAPH_IDENTIFIER_MAX_LENGTH);
const RuntimeFieldName = z.string().regex(/^[a-z][a-zA-Z0-9]{0,99}$/);
const RuntimeVariableName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/);

const WorkflowStringField = z
  .object({
    type: z.literal('string'),
    minLength: z.number().int().min(0).max(WORKFLOW_INPUT_MAX_STRING_LENGTH).optional(),
    maxLength: z.number().int().min(0).max(WORKFLOW_INPUT_MAX_STRING_LENGTH).optional(),
  })
  .strict()
  .superRefine(({ minLength, maxLength }, ctx) => {
    if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
      ctx.addIssue({ code: 'custom', message: 'minLength must not exceed maxLength' });
    }
  });

const WorkflowIntegerField = z
  .object({
    type: z.literal('integer'),
    minimum: z.number().int().safe().optional(),
    maximum: z.number().int().safe().optional(),
  })
  .strict()
  .superRefine(({ minimum, maximum }, ctx) => {
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      ctx.addIssue({ code: 'custom', message: 'minimum must not exceed maximum' });
    }
  });

const WorkflowInputField = z.discriminatedUnion('type', [
  WorkflowStringField,
  WorkflowIntegerField,
  z.object({ type: z.literal('boolean') }).strict(),
]);

export const WorkflowInputSchema = z
  .object({
    type: z.literal('object'),
    properties: z.record(RuntimeFieldName, WorkflowInputField),
    required: z.array(RuntimeFieldName).max(WORKFLOW_INPUT_MAX_FIELDS),
    additionalProperties: z.literal(false),
  })
  .strict()
  .superRefine(({ properties, required }, ctx) => {
    if (Object.keys(properties).length > WORKFLOW_INPUT_MAX_FIELDS) {
      ctx.addIssue({
        code: 'custom',
        message: 'Too many workflow input fields',
        path: ['properties'],
      });
    }
    const seen = new Set<string>();
    required.forEach((field, index) => {
      if (seen.has(field) || !Object.hasOwn(properties, field)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Invalid required field',
          path: ['required', index],
        });
      }
      seen.add(field);
    });
  });

export const RuntimeInputSource = z.discriminatedUnion('source', [
  z.strictObject({
    source: z.literal(WorkflowBindingKind.LITERAL),
    value: z.union([z.string(), z.number().int().safe(), z.boolean()]),
  }),
  z.strictObject({
    source: z.literal(WorkflowBindingKind.WORKFLOW_INPUT),
    inputName: RuntimeFieldName,
  }),
  z.strictObject({
    source: z.literal(WorkflowBindingKind.NODE_OUTPUT),
    nodeId: RuntimeIdentifier,
    field: RuntimeFieldName,
  }),
  z.strictObject({
    source: z.literal(WorkflowBindingKind.FLOW_VARIABLE),
    name: RuntimeVariableName,
  }),
  z.strictObject({
    source: z.literal(WorkflowBindingKind.GLOBAL_VARIABLE),
    name: RuntimeVariableName,
  }),
]);

const RuntimeJsonObject = z
  .record(z.string(), z.json())
  .refine((value) => Object.keys(value).length <= WORKFLOW_INPUT_MAX_FIELDS);

export const RuntimeIrNode = z
  .object({
    id: RuntimeIdentifier,
    type: z.string().min(1).max(NODE_TYPE_MAX_LENGTH).regex(NODE_TYPE_PATTERN),
    runtimeHandler: z
      .string()
      .min(1)
      .max(NODE_RUNTIME_HANDLER_MAX_LENGTH)
      .regex(NODE_RUNTIME_HANDLER_PATTERN),
    config: RuntimeJsonObject,
    inputs: z
      .record(z.string(), RuntimeInputSource)
      .refine((value) => Object.keys(value).length <= WORKFLOW_INPUT_MAX_FIELDS),
    timeoutMs: z.number().int().min(1).max(MAX_NODE_TIMEOUT_MS),
    retryPolicy: z
      .object({
        maxAttempts: z.number().int().min(1).max(WORKFLOW_NODE_MAX_ATTEMPTS),
        delayMs: z.number().int().min(0).max(WORKFLOW_NODE_MAX_RETRY_DELAY_MS),
      })
      .strict(),
    errorPolicy: z.enum([NodeErrorPolicy.STOP, NodeErrorPolicy.ERROR_BRANCH]),
  })
  .strict();

export const RuntimeIrEdge = z
  .object({
    id: RuntimeIdentifier,
    sourceNodeId: RuntimeIdentifier,
    sourcePort: RuntimeIdentifier,
    targetNodeId: RuntimeIdentifier,
  })
  .strict();

export const RuntimeIr = z
  .object({
    formatVersion: z.literal(RUNTIME_IR_FORMAT_VERSION),
    minimumRuntimeVersion: z.string().regex(STRICT_SEMANTIC_VERSION_PATTERN),
    metadata: z.object({ sourceGraphSchemaVersion: z.number().int().positive().safe() }).strict(),
    entryNodeId: RuntimeIdentifier,
    inputSchema: WorkflowInputSchema,
    nodes: z.array(RuntimeIrNode).min(2).max(EDITOR_GRAPH_MAX_NODES),
    edges: z.array(RuntimeIrEdge).min(1).max(EDITOR_GRAPH_MAX_EDGES),
    requiredCapabilities: z.array(
      z.string().min(1).max(NODE_CAPABILITY_CODE_MAX_LENGTH).regex(NODE_CAPABILITY_CODE_PATTERN),
    ),
  })
  .strict()
  .superRefine(({ requiredCapabilities }, ctx) => {
    if (new Set(requiredCapabilities).size !== requiredCapabilities.length) {
      ctx.addIssue({ code: 'custom', message: 'Required capabilities must be unique' });
    }
  });

export const CompileProjectDraftOutput = z
  .object({
    sourceDraftVersion: z.number().int().positive().safe(),
    success: z.boolean(),
    runtimeIr: RuntimeIr.nullable(),
    validation: WorkflowValidationOutput,
  })
  .strict()
  .superRefine(({ success, runtimeIr, validation }, ctx) => {
    if (success !== (runtimeIr !== null && validation.errors.length === 0)) {
      ctx.addIssue({ code: 'custom', message: 'Compilation result is inconsistent' });
    }
  });

export type WorkflowInputSchemaType = z.infer<typeof WorkflowInputSchema>;
export type RuntimeInputSourceType = z.infer<typeof RuntimeInputSource>;
export type RuntimeIrType = z.infer<typeof RuntimeIr>;
export type CompileProjectDraftOutputType = z.infer<typeof CompileProjectDraftOutput>;

export type WorkflowCompileResult =
  | {
      success: true;
      runtimeIr: RuntimeIrType;
      validation: WorkflowValidationOutputType;
    }
  | {
      success: false;
      validation: WorkflowValidationOutputType;
    };
