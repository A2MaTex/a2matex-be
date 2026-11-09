import {
  DEFAULT_FLOW_NODE_TIMEOUT_MS,
  MAX_DELAY_DURATION_MS,
  MAX_LOG_MESSAGE_LENGTH,
  MAX_NODE_TIMEOUT_MS,
  NodeCategory,
  NodeErrorPolicy,
  NodeOutputPort,
  NodeOutputPortKind,
} from '../node-catalog.constant.ts';
import type { NodeDefinitionType } from '../node-definition.model.ts';

const EMPTY_OBJECT_SCHEMA: NodeDefinitionType['configSchema'] = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
};

const SUCCESS_PORT: NodeDefinitionType['outputPorts']['ports'][number] = {
  key: NodeOutputPort.SUCCESS,
  kind: NodeOutputPortKind.CONTROL,
  label: 'Success',
};

const ERROR_PORT: NodeDefinitionType['outputPorts']['ports'][number] = {
  key: NodeOutputPort.ERROR,
  kind: NodeOutputPortKind.ERROR,
  label: 'Error',
};

const STOP_ONLY: NodeDefinitionType['supportedErrorPolicies'] = {
  supported: [NodeErrorPolicy.STOP],
};

const STOP_OR_ERROR_BRANCH: NodeDefinitionType['supportedErrorPolicies'] = {
  supported: [NodeErrorPolicy.STOP, NodeErrorPolicy.ERROR_BRANCH],
};

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
    editorHints: {
      icon: 'play',
      fieldOrder: [],
    },
    supportedErrorPolicies: STOP_ONLY,
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
    editorHints: {
      icon: 'stop',
      fieldOrder: [],
    },
    supportedErrorPolicies: STOP_ONLY,
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
    editorHints: {
      icon: 'clock',
      fieldOrder: ['durationMs'],
    },
    supportedErrorPolicies: STOP_OR_ERROR_BRANCH,
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
    editorHints: {
      icon: 'text',
      fieldOrder: ['message'],
    },
    supportedErrorPolicies: STOP_OR_ERROR_BRANCH,
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
        timeoutMs: { type: 'integer', minimum: 1, maximum: MAX_NODE_TIMEOUT_MS },
      },
      required: ['name', 'timeoutMs'],
    },
    inputSchema: EMPTY_OBJECT_SCHEMA,
    outputSchema: EMPTY_OBJECT_SCHEMA,
    outputPorts: { ports: [SUCCESS_PORT, ERROR_PORT] },
    editorHints: { icon: 'timer', fieldOrder: ['name', 'timeoutMs'] },
    supportedErrorPolicies: STOP_OR_ERROR_BRANCH,
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
    configSchema: EMPTY_OBJECT_SCHEMA,
    inputSchema: EMPTY_OBJECT_SCHEMA,
    outputSchema: EMPTY_OBJECT_SCHEMA,
    outputPorts: { ports: [ERROR_PORT] },
    editorHints: { icon: 'git-branch', fieldOrder: [] },
    supportedErrorPolicies: STOP_OR_ERROR_BRANCH,
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
        scope: { type: 'string', pattern: '^(FLOW|RUN_GROUP)$' },
      },
      required: ['name'],
    },
    inputSchema: EMPTY_OBJECT_SCHEMA,
    outputSchema: EMPTY_OBJECT_SCHEMA,
    outputPorts: { ports: [SUCCESS_PORT, ERROR_PORT] },
    editorHints: { icon: 'variable', fieldOrder: ['scope', 'name'] },
    supportedErrorPolicies: STOP_OR_ERROR_BRANCH,
    capabilities: [],
  },
];
