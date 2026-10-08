import { z } from 'zod';
import {
  MAX_NODE_TIMEOUT_MS,
  NODE_CAPABILITY_CODE_MAX_LENGTH,
  NODE_CAPABILITY_CODE_PATTERN,
  NODE_FIELD_NAME_MAX_LENGTH,
  NODE_FIELD_NAME_PATTERN,
  NODE_ICON_MAX_LENGTH,
  NODE_NAME_MAX_LENGTH,
  NODE_RUNTIME_HANDLER_MAX_LENGTH,
  NODE_RUNTIME_HANDLER_PATTERN,
  NODE_RUNTIME_VERSION_MAX_LENGTH,
  NODE_TYPE_MAX_LENGTH,
  NODE_TYPE_PATTERN,
  NodeCategory,
  NodeErrorPolicy,
  NodeOutputPort,
  NodeOutputPortKind,
  STRICT_SEMANTIC_VERSION_PATTERN,
} from './node-catalog.constant.ts';

const NodeFieldSchema = z.record(z.string(), z.json());

export const NodeObjectSchema = z
  .object({
    type: z.literal('object'),
    properties: z.record(z.string(), NodeFieldSchema),
    required: z.array(z.string().min(1).max(NODE_FIELD_NAME_MAX_LENGTH)),
    additionalProperties: z.literal(false),
  })
  .strict()
  .superRefine(({ properties, required }, ctx) => {
    Object.keys(properties).forEach((field) => {
      if (field.length > NODE_FIELD_NAME_MAX_LENGTH || !NODE_FIELD_NAME_PATTERN.test(field)) {
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

const NodeOutputPortContract = z
  .object({
    key: z.enum([
      NodeOutputPort.SUCCESS,
      NodeOutputPort.ERROR,
      NodeOutputPort.TRUE,
      NodeOutputPort.FALSE,
      NodeOutputPort.BODY,
      NodeOutputPort.COMPLETED,
    ]),
    kind: z.enum([NodeOutputPortKind.CONTROL, NodeOutputPortKind.ERROR]),
    label: z.string().trim().min(1).max(NODE_NAME_MAX_LENGTH),
  })
  .strict()
  .superRefine(({ key, kind }, ctx) => {
    const expectedKind =
      key === NodeOutputPort.ERROR ? NodeOutputPortKind.ERROR : NodeOutputPortKind.CONTROL;
    if (kind !== expectedKind) {
      ctx.addIssue({
        code: 'custom',
        message: `Port '${key}' must use kind '${expectedKind}'`,
        path: ['kind'],
      });
    }
  });

const NodeOutputPortsContract = z
  .object({
    ports: z.array(NodeOutputPortContract),
  })
  .strict()
  .superRefine(({ ports }, ctx) => {
    const portKeys = new Set<string>();
    ports.forEach(({ key }, index) => {
      if (portKeys.has(key)) {
        ctx.addIssue({
          code: 'custom',
          message: `Output port '${key}' must be unique`,
          path: ['ports', index, 'key'],
        });
      }
      portKeys.add(key);
    });
  });

const NodeEditorHintsContract = z
  .object({
    icon: z.string().trim().min(1).max(NODE_ICON_MAX_LENGTH),
    fieldOrder: z.array(
      z.string().min(1).max(NODE_FIELD_NAME_MAX_LENGTH).regex(NODE_FIELD_NAME_PATTERN),
    ),
  })
  .strict();

const NodeErrorPoliciesContract = z
  .object({
    supported: z.array(z.enum([NodeErrorPolicy.STOP, NodeErrorPolicy.ERROR_BRANCH])),
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
    supportedErrorPolicies: NodeErrorPoliciesContract,
    capabilities: z.array(
      z.string().min(1).max(NODE_CAPABILITY_CODE_MAX_LENGTH).regex(NODE_CAPABILITY_CODE_PATTERN),
    ),
  })
  .strict()
  .superRefine((definition, ctx) => {
    const availableFields = new Set([
      ...Object.keys(definition.configSchema.properties),
      ...Object.keys(definition.inputSchema.properties),
    ]);
    const orderedFields = new Set<string>();

    definition.editorHints.fieldOrder.forEach((field, index) => {
      if (orderedFields.has(field)) {
        ctx.addIssue({
          code: 'custom',
          message: `Editor field '${field}' must be unique`,
          path: ['editorHints', 'fieldOrder', index],
        });
      }
      orderedFields.add(field);

      if (!availableFields.has(field)) {
        ctx.addIssue({
          code: 'custom',
          message: `Editor field '${field}' must exist in configSchema or inputSchema`,
          path: ['editorHints', 'fieldOrder', index],
        });
      }
    });

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

    const errorPolicies = new Set<string>();
    definition.supportedErrorPolicies.supported.forEach((policy, index) => {
      if (errorPolicies.has(policy)) {
        ctx.addIssue({
          code: 'custom',
          message: `Error policy '${policy}' must be unique`,
          path: ['supportedErrorPolicies', 'supported', index],
        });
      }
      errorPolicies.add(policy);
    });

    const hasErrorPort = definition.outputPorts.ports.some(
      ({ key }) => key === NodeOutputPort.ERROR,
    );
    const supportsErrorBranch = errorPolicies.has(NodeErrorPolicy.ERROR_BRANCH);
    if (hasErrorPort !== supportsErrorBranch) {
      ctx.addIssue({
        code: 'custom',
        message: 'ERROR_BRANCH support and the error output port must be declared together',
        path: ['supportedErrorPolicies', 'supported'],
      });
    }
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
