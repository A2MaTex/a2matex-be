import {
  DEFAULT_ANDROID_NODE_TIMEOUT_MS,
  MAX_ANDROID_COORDINATE,
  MAX_ANDROID_INPUT_TEXT_LENGTH,
  MAX_ANDROID_PACKAGE_NAME_LENGTH,
  MAX_SWIPE_DURATION_MS,
  NodeCapability,
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

const SUCCESS_AND_ERROR_PORTS: NodeDefinitionType['outputPorts'] = {
  ports: [
    {
      key: NodeOutputPort.SUCCESS,
      kind: NodeOutputPortKind.CONTROL,
      label: 'Success',
    },
    {
      key: NodeOutputPort.ERROR,
      kind: NodeOutputPortKind.ERROR,
      label: 'Error',
    },
  ],
};

const STOP_OR_ERROR_BRANCH: NodeDefinitionType['supportedErrorPolicies'] = {
  supported: [NodeErrorPolicy.STOP, NodeErrorPolicy.ERROR_BRANCH],
};

const DEVICE_CONTROL_CAPABILITY: NodeDefinitionType['capabilities'] = [
  NodeCapability.ANDROID_DEVICE_CONTROL,
];

const DISPATCH_OUTPUT_SCHEMA: NodeDefinitionType['outputSchema'] = {
  type: 'object',
  properties: {
    dispatched: {
      type: 'boolean',
    },
    durationMs: {
      type: 'integer',
      minimum: 0,
    },
  },
  required: ['dispatched', 'durationMs'],
  additionalProperties: false,
};

export const ANDROID_NODE_DEFINITIONS: NodeDefinitionType[] = [
  {
    type: 'android.launch_app',
    name: 'Launch App',
    description: 'Launch an installed Android application by package name.',
    category: NodeCategory.ANDROID,
    runtimeHandler: 'android.launch_app',
    minimumRuntimeVersion: '0.1.0',
    defaultTimeoutMs: DEFAULT_ANDROID_NODE_TIMEOUT_MS,
    configSchema: EMPTY_OBJECT_SCHEMA,
    inputSchema: {
      type: 'object',
      properties: {
        packageName: {
          type: 'string',
          minLength: 3,
          maxLength: MAX_ANDROID_PACKAGE_NAME_LENGTH,
          pattern: '^[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z][A-Za-z0-9_]*)+$',
        },
      },
      required: ['packageName'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        launched: {
          type: 'boolean',
        },
        durationMs: {
          type: 'integer',
          minimum: 0,
        },
      },
      required: ['launched', 'durationMs'],
      additionalProperties: false,
    },
    outputPorts: SUCCESS_AND_ERROR_PORTS,
    editorHints: {
      icon: 'rocket',
      fieldOrder: ['packageName'],
    },
    supportedErrorPolicies: STOP_OR_ERROR_BRANCH,
    capabilities: DEVICE_CONTROL_CAPABILITY,
  },
  {
    type: 'android.tap',
    name: 'Tap',
    description: 'Tap an absolute coordinate on the selected Android device.',
    category: NodeCategory.ANDROID,
    runtimeHandler: 'android.tap',
    minimumRuntimeVersion: '0.1.0',
    defaultTimeoutMs: DEFAULT_ANDROID_NODE_TIMEOUT_MS,
    configSchema: EMPTY_OBJECT_SCHEMA,
    inputSchema: {
      type: 'object',
      properties: {
        x: {
          type: 'integer',
          minimum: 0,
          maximum: MAX_ANDROID_COORDINATE,
        },
        y: {
          type: 'integer',
          minimum: 0,
          maximum: MAX_ANDROID_COORDINATE,
        },
      },
      required: ['x', 'y'],
      additionalProperties: false,
    },
    outputSchema: DISPATCH_OUTPUT_SCHEMA,
    outputPorts: SUCCESS_AND_ERROR_PORTS,
    editorHints: {
      icon: 'mouse-pointer-click',
      fieldOrder: ['x', 'y'],
    },
    supportedErrorPolicies: STOP_OR_ERROR_BRANCH,
    capabilities: DEVICE_CONTROL_CAPABILITY,
  },
  {
    type: 'android.swipe',
    name: 'Swipe',
    description: 'Swipe between two absolute coordinates on the selected Android device.',
    category: NodeCategory.ANDROID,
    runtimeHandler: 'android.swipe',
    minimumRuntimeVersion: '0.1.0',
    defaultTimeoutMs: DEFAULT_ANDROID_NODE_TIMEOUT_MS,
    configSchema: EMPTY_OBJECT_SCHEMA,
    inputSchema: {
      type: 'object',
      properties: {
        startX: { type: 'integer', minimum: 0, maximum: MAX_ANDROID_COORDINATE },
        startY: { type: 'integer', minimum: 0, maximum: MAX_ANDROID_COORDINATE },
        endX: { type: 'integer', minimum: 0, maximum: MAX_ANDROID_COORDINATE },
        endY: { type: 'integer', minimum: 0, maximum: MAX_ANDROID_COORDINATE },
        durationMs: { type: 'integer', minimum: 1, maximum: MAX_SWIPE_DURATION_MS },
      },
      required: ['startX', 'startY', 'endX', 'endY', 'durationMs'],
      additionalProperties: false,
    },
    outputSchema: DISPATCH_OUTPUT_SCHEMA,
    outputPorts: SUCCESS_AND_ERROR_PORTS,
    editorHints: {
      icon: 'move',
      fieldOrder: ['startX', 'startY', 'endX', 'endY', 'durationMs'],
    },
    supportedErrorPolicies: STOP_OR_ERROR_BRANCH,
    capabilities: DEVICE_CONTROL_CAPABILITY,
  },
  {
    type: 'android.input_text',
    name: 'Input Text',
    description: 'Enter text into the currently focused Android field.',
    category: NodeCategory.ANDROID,
    runtimeHandler: 'android.input_text',
    minimumRuntimeVersion: '0.1.0',
    defaultTimeoutMs: DEFAULT_ANDROID_NODE_TIMEOUT_MS,
    configSchema: EMPTY_OBJECT_SCHEMA,
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          maxLength: MAX_ANDROID_INPUT_TEXT_LENGTH,
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
    outputSchema: DISPATCH_OUTPUT_SCHEMA,
    outputPorts: SUCCESS_AND_ERROR_PORTS,
    editorHints: {
      icon: 'keyboard',
      fieldOrder: ['text'],
    },
    supportedErrorPolicies: STOP_OR_ERROR_BRANCH,
    capabilities: DEVICE_CONTROL_CAPABILITY,
  },
  {
    type: 'android.press_back',
    name: 'Press Back',
    description: 'Press the Android back button.',
    category: NodeCategory.ANDROID,
    runtimeHandler: 'android.press_back',
    minimumRuntimeVersion: '0.1.0',
    defaultTimeoutMs: DEFAULT_ANDROID_NODE_TIMEOUT_MS,
    configSchema: EMPTY_OBJECT_SCHEMA,
    inputSchema: EMPTY_OBJECT_SCHEMA,
    outputSchema: DISPATCH_OUTPUT_SCHEMA,
    outputPorts: SUCCESS_AND_ERROR_PORTS,
    editorHints: {
      icon: 'arrow-left',
      fieldOrder: [],
    },
    supportedErrorPolicies: STOP_OR_ERROR_BRANCH,
    capabilities: DEVICE_CONTROL_CAPABILITY,
  },
  {
    type: 'android.press_home',
    name: 'Press Home',
    description: 'Press the Android home button.',
    category: NodeCategory.ANDROID,
    runtimeHandler: 'android.press_home',
    minimumRuntimeVersion: '0.1.0',
    defaultTimeoutMs: DEFAULT_ANDROID_NODE_TIMEOUT_MS,
    configSchema: EMPTY_OBJECT_SCHEMA,
    inputSchema: EMPTY_OBJECT_SCHEMA,
    outputSchema: DISPATCH_OUTPUT_SCHEMA,
    outputPorts: SUCCESS_AND_ERROR_PORTS,
    editorHints: {
      icon: 'house',
      fieldOrder: [],
    },
    supportedErrorPolicies: STOP_OR_ERROR_BRANCH,
    capabilities: DEVICE_CONTROL_CAPABILITY,
  },
  {
    type: 'android.screenshot',
    name: 'Screenshot',
    description: 'Capture the selected Android device screen as a local execution artifact.',
    category: NodeCategory.ANDROID,
    runtimeHandler: 'android.screenshot',
    minimumRuntimeVersion: '0.1.0',
    defaultTimeoutMs: DEFAULT_ANDROID_NODE_TIMEOUT_MS,
    configSchema: EMPTY_OBJECT_SCHEMA,
    inputSchema: EMPTY_OBJECT_SCHEMA,
    outputSchema: {
      type: 'object',
      properties: {
        artifactId: {
          type: 'string',
          minLength: 1,
        },
        width: {
          type: 'integer',
          minimum: 1,
        },
        height: {
          type: 'integer',
          minimum: 1,
        },
      },
      required: ['artifactId', 'width', 'height'],
      additionalProperties: false,
    },
    outputPorts: SUCCESS_AND_ERROR_PORTS,
    editorHints: {
      icon: 'camera',
      fieldOrder: [],
    },
    supportedErrorPolicies: STOP_OR_ERROR_BRANCH,
    capabilities: [NodeCapability.ANDROID_SCREEN_CAPTURE],
  },
];
