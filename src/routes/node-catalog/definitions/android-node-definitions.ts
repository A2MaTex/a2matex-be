import {
  DEFAULT_ANDROID_NODE_TIMEOUT_MS,
  MAX_ANDROID_COORDINATE,
  MAX_ANDROID_INPUT_TEXT_LENGTH,
  MAX_ANDROID_PACKAGE_NAME_LENGTH,
  MAX_SWIPE_DURATION_MS,
  NodeCapability,
  NodeCategory,
  NodeOutputPort,
} from '../node-catalog.constant.ts';
import type { NodeDefinitionType } from '../node-definition.model.ts';

const EMPTY_OBJECT_SCHEMA: NodeDefinitionType['configSchema'] = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
};

const SUCCESS_AND_ERROR_PORTS: NodeDefinitionType['outputPorts'] = {
  ports: [NodeOutputPort.SUCCESS, NodeOutputPort.ERROR],
};

const DEVICE_CONTROL_CAPABILITY: NodeDefinitionType['capabilities'] = [
  NodeCapability.ANDROID_DEVICE_CONTROL,
];

const PIXEL_COORDINATE_FIELD = {
  type: 'integer',
  minimum: 0,
  maximum: MAX_ANDROID_COORDINATE,
} as const;
const PERCENT_COORDINATE_FIELD = {
  type: 'integer',
  minimum: 0,
  maximum: 100,
} as const;
const SELECTOR_ID_FIELD = {
  type: 'string',
  pattern: '^[^\\s:]+:id/[^\\s/]+$',
} as const;
const SWIPE_DURATION_FIELD = {
  type: 'integer',
  minimum: 1,
  maximum: MAX_SWIPE_DURATION_MS,
} as const;
const HOLD_DURATION_FIELD = {
  type: 'integer',
  minimum: 1,
} as const;

type TargetingContract = NonNullable<NodeDefinitionType['editorHints']['targeting']>;
type TargetingModeDefinition = TargetingContract['modes'][number];

function targetingMode(
  mode: TargetingModeDefinition['mode'],
  properties: TargetingModeDefinition['bindingSchema']['properties'],
): TargetingModeDefinition {
  const required = Object.keys(properties);
  return {
    mode,
    bindingSchema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
  };
}

const POINT_TARGETING: TargetingContract = {
  modes: [
    targetingMode('ABSOLUTE_PIXELS', {
      x: PIXEL_COORDINATE_FIELD,
      y: PIXEL_COORDINATE_FIELD,
    }),
    targetingMode('SCREEN_PERCENT', {
      xPercent: PERCENT_COORDINATE_FIELD,
      yPercent: PERCENT_COORDINATE_FIELD,
    }),
    targetingMode('SELECTOR_ID', { selector_id: SELECTOR_ID_FIELD }),
  ],
};

const SWIPE_TARGETING: TargetingContract = {
  modes: [
    targetingMode('ABSOLUTE_PIXELS', {
      startX: PIXEL_COORDINATE_FIELD,
      startY: PIXEL_COORDINATE_FIELD,
      endX: PIXEL_COORDINATE_FIELD,
      endY: PIXEL_COORDINATE_FIELD,
      durationMs: SWIPE_DURATION_FIELD,
    }),
    targetingMode('SCREEN_PERCENT', {
      startXPercent: PERCENT_COORDINATE_FIELD,
      startYPercent: PERCENT_COORDINATE_FIELD,
      endXPercent: PERCENT_COORDINATE_FIELD,
      endYPercent: PERCENT_COORDINATE_FIELD,
      durationMs: SWIPE_DURATION_FIELD,
    }),
  ],
};

const LONG_PRESS_TARGETING: TargetingContract = {
  modes: POINT_TARGETING.modes.map((definition) => ({
    ...definition,
    bindingSchema: {
      ...definition.bindingSchema,
      properties: {
        ...definition.bindingSchema.properties,
        durationMs: HOLD_DURATION_FIELD,
      },
      required: [...definition.bindingSchema.required, 'durationMs'],
    },
  })),
};

function targetModeConfig(targeting: TargetingContract): NodeDefinitionType['configSchema'] {
  return {
    type: 'object',
    properties: {
      targetMode: {
        type: 'string',
        enum: targeting.modes.map(({ mode }) => mode),
      },
    },
    required: ['targetMode'],
    additionalProperties: false,
  };
}

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
    outputSchema: EMPTY_OBJECT_SCHEMA,
    outputPorts: SUCCESS_AND_ERROR_PORTS,
    editorHints: {},
    capabilities: DEVICE_CONTROL_CAPABILITY,
  },
  {
    type: 'android.tap',
    name: 'Tap',
    description: 'Tap a selected target on the Android device.',
    category: NodeCategory.ANDROID,
    runtimeHandler: 'android.tap',
    minimumRuntimeVersion: '0.1.0',
    defaultTimeoutMs: DEFAULT_ANDROID_NODE_TIMEOUT_MS,
    configSchema: targetModeConfig(POINT_TARGETING),
    inputSchema: EMPTY_OBJECT_SCHEMA,
    outputSchema: EMPTY_OBJECT_SCHEMA,
    outputPorts: SUCCESS_AND_ERROR_PORTS,
    editorHints: {
      targeting: POINT_TARGETING,
    },
    capabilities: DEVICE_CONTROL_CAPABILITY,
  },
  {
    type: 'android.swipe',
    name: 'Swipe',
    description: 'Swipe between two selected points on the Android device.',
    category: NodeCategory.ANDROID,
    runtimeHandler: 'android.swipe',
    minimumRuntimeVersion: '0.1.0',
    defaultTimeoutMs: DEFAULT_ANDROID_NODE_TIMEOUT_MS,
    configSchema: targetModeConfig(SWIPE_TARGETING),
    inputSchema: EMPTY_OBJECT_SCHEMA,
    outputSchema: EMPTY_OBJECT_SCHEMA,
    outputPorts: SUCCESS_AND_ERROR_PORTS,
    editorHints: {
      targeting: SWIPE_TARGETING,
    },
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
    outputSchema: EMPTY_OBJECT_SCHEMA,
    outputPorts: SUCCESS_AND_ERROR_PORTS,
    editorHints: {},
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
    outputSchema: EMPTY_OBJECT_SCHEMA,
    outputPorts: SUCCESS_AND_ERROR_PORTS,
    editorHints: {},
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
    outputSchema: EMPTY_OBJECT_SCHEMA,
    outputPorts: SUCCESS_AND_ERROR_PORTS,
    editorHints: {},
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
      },
      required: ['artifactId'],
      additionalProperties: false,
    },
    outputPorts: SUCCESS_AND_ERROR_PORTS,
    editorHints: {},
    capabilities: [NodeCapability.ANDROID_SCREEN_CAPTURE],
  },
  {
    type: 'android.long_press',
    name: 'Long Press',
    description: 'Press and hold a point on the selected Android device.',
    category: NodeCategory.ANDROID,
    runtimeHandler: 'android.long_press',
    minimumRuntimeVersion: '0.1.0',
    defaultTimeoutMs: DEFAULT_ANDROID_NODE_TIMEOUT_MS,
    configSchema: targetModeConfig(LONG_PRESS_TARGETING),
    inputSchema: EMPTY_OBJECT_SCHEMA,
    outputSchema: EMPTY_OBJECT_SCHEMA,
    outputPorts: SUCCESS_AND_ERROR_PORTS,
    editorHints: {
      targeting: LONG_PRESS_TARGETING,
    },
    capabilities: DEVICE_CONTROL_CAPABILITY,
  },
];
