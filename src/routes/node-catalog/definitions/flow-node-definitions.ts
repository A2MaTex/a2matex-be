import {
  DEFAULT_FLOW_NODE_TIMEOUT_MS,
  MAX_DELAY_DURATION_MS,
  MAX_LOG_MESSAGE_LENGTH,
  MAX_NODE_TIMEOUT_MS,
  MAX_SWITCH_RULES,
  NodeCategory,
  NodeOutputPort,
  SwitchOperator,
} from '../node-catalog.constant.ts';
import type { NodeDefinitionType } from '../node-definition.model.ts';
import { WorkflowBindingKind } from '../../../shared/constants/workflow-validation.constant.ts';

const EMPTY_OBJECT_SCHEMA: NodeDefinitionType['configSchema'] = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
};

const SUCCESS_PORT: NodeDefinitionType['outputPorts']['ports'][number] = NodeOutputPort.SUCCESS;
const ERROR_PORT: NodeDefinitionType['outputPorts']['ports'][number] = NodeOutputPort.ERROR;
const DEFAULT_PORT: NodeDefinitionType['outputPorts']['ports'][number] = NodeOutputPort.DEFAULT;
const ALL_BINDING_KINDS: NodeDefinitionType['editorHints']['bindingKinds'] =
  Object.values(WorkflowBindingKind);
const ALL_BINDING_DEFINITIONS = {
  [WorkflowBindingKind.LITERAL]: {
    fields: {
      value: { types: ['string', 'number', 'boolean'] },
    },
  },
  [WorkflowBindingKind.WORKFLOW_INPUT]: { fields: ['inputName'] },
  [WorkflowBindingKind.NODE_OUTPUT]: { fields: ['nodeId', 'field'] },
  [WorkflowBindingKind.FLOW_VARIABLE]: { fields: ['name'] },
  [WorkflowBindingKind.GLOBAL_VARIABLE]: { fields: ['name'] },
};

const SWITCH_OPERATOR_OPTIONS = [
  { value: SwitchOperator.EQ, supportedTypes: ['string', 'number', 'boolean'], operandCount: 1 },
  { value: SwitchOperator.NE, supportedTypes: ['string', 'number', 'boolean'], operandCount: 1 },
  { value: SwitchOperator.LT, supportedTypes: ['number'], operandCount: 1 },
  { value: SwitchOperator.LTE, supportedTypes: ['number'], operandCount: 1 },
  { value: SwitchOperator.GT, supportedTypes: ['number'], operandCount: 1 },
  { value: SwitchOperator.GTE, supportedTypes: ['number'], operandCount: 1 },
  { value: SwitchOperator.CONTAINS, supportedTypes: ['string'], operandCount: 1 },
  { value: SwitchOperator.NOT_CONTAINS, supportedTypes: ['string'], operandCount: 1 },
  { value: SwitchOperator.STARTS_WITH, supportedTypes: ['string'], operandCount: 1 },
  { value: SwitchOperator.ENDS_WITH, supportedTypes: ['string'], operandCount: 1 },
  { value: SwitchOperator.IS_EMPTY, supportedTypes: ['string'], operandCount: 0 },
  { value: SwitchOperator.IS_NOT_EMPTY, supportedTypes: ['string'], operandCount: 0 },
  { value: SwitchOperator.IS_TRUE, supportedTypes: ['boolean'], operandCount: 0 },
  { value: SwitchOperator.IS_FALSE, supportedTypes: ['boolean'], operandCount: 0 },
];

export const FLOW_NODE_DEFINITIONS: NodeDefinitionType[] = [
  {
    type: 'flow.start',
    name: 'Start',
    description: 'Start workflow execution.',
    category: NodeCategory.FLOW,
    runtimeHandler: 'flow.start',
    minimumRuntimeVersion: '0.1.0',
    defaultTimeoutMs: DEFAULT_FLOW_NODE_TIMEOUT_MS,
    configSchema: EMPTY_OBJECT_SCHEMA,
    inputSchema: EMPTY_OBJECT_SCHEMA,
    outputSchema: EMPTY_OBJECT_SCHEMA,
    outputPorts: {
      ports: [SUCCESS_PORT],
    },
    editorHints: {},
    capabilities: [],
  },
  {
    type: 'flow.end',
    name: 'End',
    description: 'End workflow execution successfully.',
    category: NodeCategory.FLOW,
    runtimeHandler: 'flow.end',
    minimumRuntimeVersion: '0.1.0',
    defaultTimeoutMs: DEFAULT_FLOW_NODE_TIMEOUT_MS,
    configSchema: EMPTY_OBJECT_SCHEMA,
    inputSchema: EMPTY_OBJECT_SCHEMA,
    outputSchema: EMPTY_OBJECT_SCHEMA,
    outputPorts: {
      ports: [],
    },
    editorHints: {},
    capabilities: [],
  },
  {
    type: 'flow.delay',
    name: 'Delay',
    description: 'Wait for a bounded duration before continuing.',
    category: NodeCategory.FLOW,
    runtimeHandler: 'flow.delay',
    minimumRuntimeVersion: '0.1.0',
    defaultTimeoutMs: MAX_DELAY_DURATION_MS,
    configSchema: EMPTY_OBJECT_SCHEMA,
    inputSchema: {
      type: 'object',
      properties: {
        durationMs: {
          type: 'integer',
          minimum: 0,
          maximum: MAX_DELAY_DURATION_MS,
        },
      },
      required: ['durationMs'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        durationMs: {
          type: 'integer',
          minimum: 0,
        },
      },
      required: ['durationMs'],
      additionalProperties: false,
    },
    outputPorts: {
      ports: [SUCCESS_PORT, ERROR_PORT],
    },
    editorHints: { bindingKinds: ALL_BINDING_KINDS },
    capabilities: [],
  },
  {
    type: 'utility.log',
    name: 'Log',
    description: 'Write a message to the development execution log.',
    category: NodeCategory.UTILITY,
    runtimeHandler: 'utility.log',
    minimumRuntimeVersion: '0.1.0',
    defaultTimeoutMs: DEFAULT_FLOW_NODE_TIMEOUT_MS,
    configSchema: EMPTY_OBJECT_SCHEMA,
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          minLength: 1,
          maxLength: MAX_LOG_MESSAGE_LENGTH,
        },
      },
      required: ['message'],
      additionalProperties: false,
    },
    outputSchema: EMPTY_OBJECT_SCHEMA,
    outputPorts: {
      ports: [SUCCESS_PORT, ERROR_PORT],
    },
    editorHints: { bindingKinds: ALL_BINDING_KINDS },
    capabilities: [],
  },
  {
    type: 'flow.wait_variable',
    name: 'Wait for Variable',
    description: 'Wait for a named Global variable to exist in the current run group.',
    category: NodeCategory.FLOW,
    runtimeHandler: 'flow.wait_variable',
    minimumRuntimeVersion: '0.1.0',
    defaultTimeoutMs: MAX_NODE_TIMEOUT_MS,
    configSchema: {
      ...EMPTY_OBJECT_SCHEMA,
      properties: {
        name: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]{0,99}$' },
      },
      required: ['name'],
    },
    inputSchema: EMPTY_OBJECT_SCHEMA,
    outputSchema: EMPTY_OBJECT_SCHEMA,
    outputPorts: { ports: [SUCCESS_PORT, ERROR_PORT] },
    editorHints: {},
    capabilities: [],
  },
  {
    type: 'flow.switch',
    name: 'Switch',
    description: 'Route to the first matching rule or the default branch.',
    category: NodeCategory.FLOW,
    runtimeHandler: 'flow.switch',
    minimumRuntimeVersion: '0.1.0',
    defaultTimeoutMs: DEFAULT_FLOW_NODE_TIMEOUT_MS,
    configSchema: {
      ...EMPTY_OBJECT_SCHEMA,
      properties: {
        rules: {
          type: 'array',
          minimumItems: 1,
          maximumItems: MAX_SWITCH_RULES,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid', readOnly: true },
              operator: { type: 'string', options: SWITCH_OPERATOR_OPTIONS },
            },
            required: ['id', 'operator'],
            additionalProperties: false,
          },
        },
      },
      required: ['rules'],
    },
    inputSchema: {
      ...EMPTY_OBJECT_SCHEMA,
      properties: {
        value: { bindingKinds: ALL_BINDING_DEFINITIONS },
      },
      dynamicInputs: {
        ruleOperand: {
          bindingKeyFrom: 'config.rules[].id',
          operandCountFrom: 'config.rules[].operator',
          bindingKinds: ALL_BINDING_DEFINITIONS,
        },
      },
      required: ['value'],
    },
    outputSchema: EMPTY_OBJECT_SCHEMA,
    outputPorts: {
      ports: [DEFAULT_PORT, ERROR_PORT],
      dynamicPorts: { keysFrom: 'config.rules[].id' },
    },
    editorHints: {},
    capabilities: [],
  },
  {
    type: 'flow.set_variable',
    name: 'Set Variable',
    description: 'Save a value under a name in the current device execution or run group.',
    category: NodeCategory.FLOW,
    runtimeHandler: 'flow.set_variable',
    minimumRuntimeVersion: '0.1.0',
    defaultTimeoutMs: DEFAULT_FLOW_NODE_TIMEOUT_MS,
    configSchema: {
      ...EMPTY_OBJECT_SCHEMA,
      properties: {
        name: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]{0,99}$' },
        scope: { type: 'string', enum: ['FLOW', 'RUN_GROUP'], default: 'FLOW' },
      },
      required: ['name', 'scope'],
    },
    inputSchema: {
      ...EMPTY_OBJECT_SCHEMA,
      properties: {
        value: {
          bindingKinds: ALL_BINDING_DEFINITIONS,
        },
      },
      required: ['value'],
    },
    outputSchema: EMPTY_OBJECT_SCHEMA,
    outputPorts: { ports: [SUCCESS_PORT, ERROR_PORT] },
    editorHints: {},
    capabilities: [],
  },
];
