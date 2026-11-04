import { z } from 'zod';
import {
  MAX_ANDROID_COORDINATE,
  MAX_SWIPE_DURATION_MS,
} from '../../node-catalog/node-catalog.constant.ts';
import {
  WORKFLOW_VALIDATION_DIAGNOSTIC_MESSAGES,
  WorkflowValidationDiagnosticCode,
} from '../../../shared/constants/workflow-validation.constant.ts';
import type { EditorGraphType, WorkflowNodeDefinitionType } from '../workflow-validation.model.ts';
import { validateNodeConfig } from './node-config.validator.ts';

const literal = (value: z.ZodType) => z.strictObject({ kind: z.literal('literal'), value });

const pixel = literal(z.number().int().min(0).max(MAX_ANDROID_COORDINATE));
const percent = literal(z.number().int().min(0).max(100));
const selector = literal(z.string().regex(/^[^\s:]+:id\/[^\s/]+$/));
const swipeDuration = literal(z.number().int().min(1).max(MAX_SWIPE_DURATION_MS));
const holdDuration = literal(z.number().int().min(1));

const pointInputs = {
  ABSOLUTE_PIXELS: { x: pixel, y: pixel },
  SCREEN_PERCENT: { xPercent: percent, yPercent: percent },
  SELECTOR_ID: { selector_id: selector },
};

const bindingsByNodeType = new Map<string, ReadonlyMap<string, z.ZodType>>([
  [
    'android.tap',
    new Map<string, z.ZodType>([
      ['ABSOLUTE_PIXELS', z.strictObject(pointInputs.ABSOLUTE_PIXELS)],
      ['SCREEN_PERCENT', z.strictObject(pointInputs.SCREEN_PERCENT)],
      ['SELECTOR_ID', z.strictObject(pointInputs.SELECTOR_ID)],
    ]),
  ],
  [
    'android.swipe',
    new Map<string, z.ZodType>([
      [
        'ABSOLUTE_PIXELS',
        z.strictObject({
          startX: pixel,
          startY: pixel,
          endX: pixel,
          endY: pixel,
          durationMs: swipeDuration,
        }),
      ],
      [
        'SCREEN_PERCENT',
        z.strictObject({
          startXPercent: percent,
          startYPercent: percent,
          endXPercent: percent,
          endYPercent: percent,
          durationMs: swipeDuration,
        }),
      ],
    ]),
  ],
  [
    'android.long_press',
    new Map(
      Object.entries(pointInputs).map(([mode, fields]) => [
        mode,
        z.strictObject({ ...fields, durationMs: holdDuration }),
      ]),
    ),
  ],
]);

export function validateNodeTargeting(
  node: EditorGraphType['nodes'][number],
  index: number,
  configSchema: WorkflowNodeDefinitionType['configSchema'],
) {
  const modes = bindingsByNodeType.get(node.type);
  const { targetMode, ...config } = node.config;

  // Existing Tap and Swipe drafts keep their original config and binding validation.
  if (!modes || (targetMode === undefined && node.type !== 'android.long_press')) {
    return validateNodeConfig(node, index, configSchema);
  }

  const bindingSchema = typeof targetMode === 'string' ? modes.get(targetMode) : undefined;
  if (!bindingSchema) {
    return validateNodeConfig(node, index, configSchema).concat(
      targetMode === undefined
        ? [
            {
              code: WorkflowValidationDiagnosticCode.NODE_CONFIG_INVALID,
              message: WORKFLOW_VALIDATION_DIAGNOSTIC_MESSAGES.NODE_CONFIG_INVALID,
              nodeId: node.id,
              path: ['nodes', index, 'config', 'targetMode'],
            },
          ]
        : [],
    );
  }

  const errors = validateNodeConfig({ ...node, config }, index, configSchema);
  const result = bindingSchema.safeParse(node.bindings);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push({
        code: WorkflowValidationDiagnosticCode.NODE_BINDINGS_INVALID,
        message: WORKFLOW_VALIDATION_DIAGNOSTIC_MESSAGES.NODE_BINDINGS_INVALID,
        nodeId: node.id,
        path: ['nodes', index, 'bindings', ...issue.path.map(String)],
      });
    }
  }
  return errors;
}
