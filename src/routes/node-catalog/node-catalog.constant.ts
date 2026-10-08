export const NodeCategory = {
  FLOW: 'FLOW',
  UTILITY: 'UTILITY',
  ANDROID: 'ANDROID',
} as const;

export const NodeOutputPortKind = {
  CONTROL: 'CONTROL',
  ERROR: 'ERROR',
} as const;

export const NodeErrorPolicy = {
  STOP: 'STOP',
  ERROR_BRANCH: 'ERROR_BRANCH',
} as const;

export const NodeCapability = {
  ANDROID_DEVICE_CONTROL: 'android.device.control',
  ANDROID_SCREEN_CAPTURE: 'android.screen.capture',
} as const;

export const NodeOutputPort = {
  SUCCESS: 'success',
  ERROR: 'error',
  TRUE: 'true',
  FALSE: 'false',
  BODY: 'body',
  COMPLETED: 'completed',
} as const;

export const NODE_TYPE_MAX_LENGTH = 255;
export const NODE_NAME_MAX_LENGTH = 255;
export const NODE_CATEGORY_MAX_LENGTH = 100;
export const NODE_RUNTIME_HANDLER_MAX_LENGTH = 255;
export const NODE_RUNTIME_VERSION_MAX_LENGTH = 100;
export const NODE_ICON_MAX_LENGTH = 100;
export const NODE_FIELD_NAME_MAX_LENGTH = 100;
export const NODE_CAPABILITY_CODE_MAX_LENGTH = 255;

export const DEFAULT_FLOW_NODE_TIMEOUT_MS = 1_000;
export const DEFAULT_ANDROID_NODE_TIMEOUT_MS = 30_000;
export const MAX_NODE_TIMEOUT_MS = 600_000;

export const MAX_DELAY_DURATION_MS = 300_000;
export const MAX_LOG_MESSAGE_LENGTH = 4_000;
export const MAX_ANDROID_PACKAGE_NAME_LENGTH = 255;
export const MAX_ANDROID_COORDINATE = 100_000;
export const MAX_SWIPE_DURATION_MS = 60_000;
export const MAX_ANDROID_INPUT_TEXT_LENGTH = 10_000;

// example: android.device.startApp, flow.branch.condition, flow.delay
export const NODE_TYPE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
export const NODE_RUNTIME_HANDLER_PATTERN = NODE_TYPE_PATTERN;
export const NODE_CAPABILITY_CODE_PATTERN = NODE_TYPE_PATTERN;
export const NODE_FIELD_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
export const STRICT_SEMANTIC_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
