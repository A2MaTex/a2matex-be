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
import { WorkflowBindingKind } from '../../shared/constants/workflow-validation.constant.ts';

const NodeFieldSchema = z.record(z.string(), z.json());
const TARGET_BINDING_FIELD_NAME_PATTERN = /^[a-z][a-zA-Z0-9_]*$/;

function objectSchema(fieldNamePattern: RegExp) {
  return z
    .object({
      type: z.literal('object'),
      properties: z.record(z.string(), NodeFieldSchema),
      dynamicInputs: z.record(z.string(), z.json()).optional(),
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
  NodeOutputPort.DEFAULT,
  NodeOutputPort.TRUE,
  NodeOutputPort.FALSE,
  NodeOutputPort.BODY,
  NodeOutputPort.COMPLETED,
]);

const NodeOutputPortsContract = z
  .object({
    ports: z.array(NodeOutputPortContract),
    dynamicPorts: z
      .object({
        keysFrom: z.literal('config.rules[].id'),
      })
      .strict()
      .optional(),
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

const WorkflowBindingKindContract = z.enum([
  WorkflowBindingKind.LITERAL,
  WorkflowBindingKind.WORKFLOW_INPUT,
  WorkflowBindingKind.NODE_OUTPUT,
  WorkflowBindingKind.FLOW_VARIABLE,
  WorkflowBindingKind.GLOBAL_VARIABLE,
]);

export const SetVariableBindingKindsContract = z
  .object({
    [WorkflowBindingKind.LITERAL]: z
      .object({
        fields: z
          .object({
            value: z
              .object({
                types: z.tuple([z.literal('string'), z.literal('number'), z.literal('boolean')]),
              })
              .strict(),
          })
          .strict(),
      })
      .strict(),
    [WorkflowBindingKind.WORKFLOW_INPUT]: z
      .object({ fields: z.tuple([z.literal('inputName')]) })
      .strict(),
    [WorkflowBindingKind.NODE_OUTPUT]: z
      .object({ fields: z.tuple([z.literal('nodeId'), z.literal('field')]) })
      .strict(),
    [WorkflowBindingKind.FLOW_VARIABLE]: z
      .object({ fields: z.tuple([z.literal('name')]) })
      .strict(),
    [WorkflowBindingKind.GLOBAL_VARIABLE]: z
      .object({ fields: z.tuple([z.literal('name')]) })
      .strict(),
  })
  .strict();

export const SwitchDynamicInputsContract = z
  .object({
    ruleOperand: z
      .object({
        bindingKeyFrom: z.literal('config.rules[].id'),
        operandCountFrom: z.literal('config.rules[].operator'),
        bindingKinds: SetVariableBindingKindsContract,
      })
      .strict(),
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
    bindingKinds: z
      .array(WorkflowBindingKindContract)
      .superRefine((bindingKinds, ctx) => {
        if (new Set(bindingKinds).size !== bindingKinds.length) {
          ctx.addIssue({
            code: 'custom',
            message: 'Binding kinds must be unique',
          });
        }
      })
      .optional(),
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
    if (definition.type === 'flow.set_variable') {
      const result = SetVariableBindingKindsContract.safeParse(
        definition.inputSchema.properties.value?.bindingKinds,
      );
      if (!result.success) {
        ctx.addIssue({
          code: 'custom',
          message: 'Set Variable must publish its value binding kinds in inputSchema',
          path: ['inputSchema', 'properties', 'value', 'bindingKinds'],
        });
      }
    }

    if (definition.type === 'flow.switch') {
      const valueBindingKinds = SetVariableBindingKindsContract.safeParse(
        definition.inputSchema.properties.value?.bindingKinds,
      );
      const dynamicInputs = SwitchDynamicInputsContract.safeParse(
        definition.inputSchema.dynamicInputs,
      );
      if (!valueBindingKinds.success) {
        ctx.addIssue({
          code: 'custom',
          message: 'Switch must publish its value binding kinds in inputSchema',
          path: ['inputSchema', 'properties', 'value', 'bindingKinds'],
        });
      }
      if (!dynamicInputs.success) {
        ctx.addIssue({
          code: 'custom',
          message: 'Switch must publish its dynamic rule operand inputs',
          path: ['inputSchema', 'dynamicInputs'],
        });
      }
      if (definition.outputPorts.dynamicPorts?.keysFrom !== 'config.rules[].id') {
        ctx.addIssue({
          code: 'custom',
          message: 'Switch must derive dynamic ports from rule IDs',
          path: ['outputPorts', 'dynamicPorts'],
        });
      }
    }

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
