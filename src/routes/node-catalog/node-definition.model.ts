import { z } from 'zod';
import {
  MAX_NODE_TIMEOUT_MS,
  NODE_CAPABILITY_CODE_MAX_LENGTH,
  NODE_CAPABILITY_CODE_PATTERN,
  NODE_FIELD_NAME_MAX_LENGTH,
  NODE_FIELD_NAME_PATTERN,
  NODE_NAME_MAX_LENGTH,
  NODE_RUNTIME_HANDLER_MAX_LENGTH,
  NODE_RUNTIME_HANDLER_PATTERN,
  NODE_RUNTIME_VERSION_MAX_LENGTH,
  NODE_TYPE_MAX_LENGTH,
  NODE_TYPE_PATTERN,
  NodeCategory,
  NodeOutputPort,
  STRICT_SEMANTIC_VERSION_PATTERN,
} from './node-catalog.constant.ts';

const NodeFieldSchema = z.record(z.string(), z.json());
const TARGET_BINDING_FIELD_NAME_PATTERN = /^[a-z][a-zA-Z0-9_]*$/;

function objectSchema(fieldNamePattern: RegExp) {
  return z
    .object({
      type: z.literal('object'),
      properties: z.record(z.string(), NodeFieldSchema),
      required: z.array(z.string().min(1).max(NODE_FIELD_NAME_MAX_LENGTH)),
      additionalProperties: z.literal(false),
    })
    .strict()
    .superRefine(({ properties, required }, ctx) => {
      Object.keys(properties).forEach((field) => {
        if (field.length > NODE_FIELD_NAME_MAX_LENGTH || !fieldNamePattern.test(field)) {
          ctx.addIssue({
            code: 'custom',
            message: `Property '${field}' must use a supported field name`,
            path: ['properties', field],
          });
        }
      });

      const requiredFields = new Set<string>();

      required.forEach((field, index) => {
        if (requiredFields.has(field)) {
          ctx.addIssue({
            code: 'custom',
            message: `Required field '${field}' must be unique`,
            path: ['required', index],
          });
        }
        requiredFields.add(field);

        if (!(field in properties)) {
          ctx.addIssue({
            code: 'custom',
            message: `Required field '${field}' must exist in properties`,
            path: ['required', index],
          });
        }
      });
    });
}

export const NodeObjectSchema = objectSchema(NODE_FIELD_NAME_PATTERN);
const TargetBindingObjectSchema = objectSchema(TARGET_BINDING_FIELD_NAME_PATTERN);

const NodeOutputPortContract = z.enum([
  NodeOutputPort.SUCCESS,
  NodeOutputPort.ERROR,
  NodeOutputPort.TRUE,
  NodeOutputPort.FALSE,
  NodeOutputPort.BODY,
  NodeOutputPort.COMPLETED,
]);

const NodeOutputPortsContract = z
  .object({
    ports: z.array(NodeOutputPortContract),
  })
  .strict()
  .superRefine(({ ports }, ctx) => {
    const portKeys = new Set<string>();
    ports.forEach((port, index) => {
      if (portKeys.has(port)) {
        ctx.addIssue({
          code: 'custom',
          message: `Output port '${port}' must be unique`,
          path: ['ports', index],
        });
      }
      portKeys.add(port);
    });
  });

const TargetMode = z.enum(['ABSOLUTE_PIXELS', 'SCREEN_PERCENT', 'SELECTOR_ID']);

const TargetModeDefinition = z
  .object({
    mode: TargetMode,
    bindingSchema: TargetBindingObjectSchema,
  })
  .strict();

export const NodeTargetingContract = z
  .object({
    modes: z.array(TargetModeDefinition).min(1),
  })
  .strict()
  .superRefine(({ modes }, ctx) => {
    const values = new Set<string>();
    modes.forEach(({ mode }, index) => {
      if (values.has(mode)) {
        ctx.addIssue({
          code: 'custom',
          message: `Targeting mode '${mode}' must be unique`,
          path: ['modes', index, 'mode'],
        });
      }
      values.add(mode);
    });
  });

const NodeEditorHintsContract = z
  .object({
    targeting: NodeTargetingContract.optional(),
  })
  .strict();

export const NodeDefinitionContract = z
  .object({
    type: z.string().min(1).max(NODE_TYPE_MAX_LENGTH).regex(NODE_TYPE_PATTERN),
    name: z.string().trim().min(1).max(NODE_NAME_MAX_LENGTH),
    description: z.string().trim().min(1),
    category: z.enum([NodeCategory.FLOW, NodeCategory.UTILITY, NodeCategory.ANDROID]),
    runtimeHandler: z
      .string()
      .min(1)
      .max(NODE_RUNTIME_HANDLER_MAX_LENGTH)
      .regex(NODE_RUNTIME_HANDLER_PATTERN),
    minimumRuntimeVersion: z
      .string()
      .min(1)
      .max(NODE_RUNTIME_VERSION_MAX_LENGTH)
      .regex(STRICT_SEMANTIC_VERSION_PATTERN),
    defaultTimeoutMs: z.number().int().positive().max(MAX_NODE_TIMEOUT_MS),
    configSchema: NodeObjectSchema,
    inputSchema: NodeObjectSchema,
    outputSchema: NodeObjectSchema,
    outputPorts: NodeOutputPortsContract,
    editorHints: NodeEditorHintsContract,
    capabilities: z.array(
      z.string().min(1).max(NODE_CAPABILITY_CODE_MAX_LENGTH).regex(NODE_CAPABILITY_CODE_PATTERN),
    ),
  })
  .strict()
  .superRefine((definition, ctx) => {
    const capabilities = new Set<string>();
    definition.capabilities.forEach((capability, index) => {
      if (capabilities.has(capability)) {
        ctx.addIssue({
          code: 'custom',
          message: `Capability '${capability}' must be unique`,
          path: ['capabilities', index],
        });
      }
      capabilities.add(capability);
    });
  });

export const NodeDefinitionCatalogContract = z
  .array(NodeDefinitionContract)
  .nonempty()
  .superRefine((definitions, ctx) => {
    const nodeTypes = new Set<string>();
    definitions.forEach((definition, index) => {
      if (nodeTypes.has(definition.type)) {
        ctx.addIssue({
          code: 'custom',
          message: `Node type '${definition.type}' must be unique`,
          path: [index, 'type'],
        });
      }
      nodeTypes.add(definition.type);
    });
  });

export type NodeDefinitionType = z.infer<typeof NodeDefinitionContract>;
