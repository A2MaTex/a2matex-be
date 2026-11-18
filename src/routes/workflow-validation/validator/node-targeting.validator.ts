import type { Prisma } from '../../../generated/prisma/client.ts';
import {
  WORKFLOW_VALIDATION_DIAGNOSTIC_MESSAGES,
  WorkflowValidationDiagnosticCode,
} from '../../../shared/constants/workflow-validation.constant.ts';
import type {
  EditorGraphType,
  WorkflowNodeDefinitionType,
  WorkflowValidationDiagnosticType,
} from '../workflow-validation.model.ts';
import { WorkflowBindingKind } from '../../../shared/constants/workflow-validation.constant.ts';
import { isNodeFieldValueValid, validateNodeConfig } from './node-config.validator.ts';

type Targeting = NonNullable<WorkflowNodeDefinitionType['editorHints']>['targeting'];
type TargetBindingSchema = NonNullable<Targeting>['modes'][number]['bindingSchema'];

function bindingDiagnostic(
  node: EditorGraphType['nodes'][number],
  nodeIndex: number,
  ...path: string[]
): WorkflowValidationDiagnosticType {
  return {
    code: WorkflowValidationDiagnosticCode.NODE_BINDINGS_INVALID,
    message:
      WORKFLOW_VALIDATION_DIAGNOSTIC_MESSAGES[
        WorkflowValidationDiagnosticCode.NODE_BINDINGS_INVALID
      ],
    nodeId: node.id,
    path: ['nodes', nodeIndex, 'bindings', ...path],
  };
}

function isJsonObject(value: unknown): value is Record<string, Prisma.JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateTargetBindings(
  node: EditorGraphType['nodes'][number],
  nodeIndex: number,
  schema: TargetBindingSchema,
  definition: WorkflowNodeDefinitionType,
): WorkflowValidationDiagnosticType[] {
  const diagnostics: WorkflowValidationDiagnosticType[] = [];

  new Set(schema.required).forEach((field) => {
    if (!Object.hasOwn(node.bindings, field)) {
      diagnostics.push(bindingDiagnostic(node, nodeIndex, field));
    }
  });

  let reportedAdditionalField = false;
  Object.entries(node.bindings).forEach(([field, value]) => {
    const fieldSchema = schema.properties[field];
    if (!fieldSchema) {
      if (!reportedAdditionalField) {
        diagnostics.push(bindingDiagnostic(node, nodeIndex));
        reportedAdditionalField = true;
      }
      return;
    }

    if (!isJsonObject(value)) {
      diagnostics.push(bindingDiagnostic(node, nodeIndex, field));
      return;
    }

    if (
      typeof value.kind !== 'string' ||
      !definition.editorHints.bindingKinds?.some((kind) => kind === value.kind) ||
      value.kind !== WorkflowBindingKind.LITERAL
    ) {
      diagnostics.push(bindingDiagnostic(node, nodeIndex, field, 'kind'));
    }
    if (!Object.hasOwn(value, 'value') || !isNodeFieldValueValid(value.value, fieldSchema)) {
      diagnostics.push(bindingDiagnostic(node, nodeIndex, field, 'value'));
    }
    if (Object.keys(value).some((key) => key !== 'kind' && key !== 'value')) {
      diagnostics.push(bindingDiagnostic(node, nodeIndex, field));
    }
  });

  return diagnostics;
}

function validateScreenshotRegion(
  node: EditorGraphType['nodes'][number],
  nodeIndex: number,
  mode: 'ABSOLUTE_PIXELS' | 'SCREEN_PERCENT',
): WorkflowValidationDiagnosticType[] {
  const suffix = mode === 'SCREEN_PERCENT' ? 'Percent' : '';
  const diagnostics: WorkflowValidationDiagnosticType[] = [];

  for (const axis of ['X', 'Y']) {
    const endField = `end${axis}${suffix}`;
    const startBinding = node.bindings[`start${axis}${suffix}`];
    const endBinding = node.bindings[endField];
    if (
      isJsonObject(startBinding) &&
      isJsonObject(endBinding) &&
      typeof startBinding.value === 'number' &&
      typeof endBinding.value === 'number' &&
      startBinding.value >= endBinding.value
    ) {
      diagnostics.push(bindingDiagnostic(node, nodeIndex, endField, 'value'));
    }
  }

  return diagnostics;
}

export function validateNodeTargeting(
  node: EditorGraphType['nodes'][number],
  nodeIndex: number,
  definition: WorkflowNodeDefinitionType,
): WorkflowValidationDiagnosticType[] {
  const errors = validateNodeConfig(node, nodeIndex, definition.configSchema);
  const targeting = definition.editorHints?.targeting;
  if (!targeting) {
    return errors;
  }

  const mode = targeting.modes.find(({ mode }) => mode === node.config.targetMode);
  if (!mode) {
    return errors;
  }

  const bindingErrors = validateTargetBindings(node, nodeIndex, mode.bindingSchema, definition);
  if (
    bindingErrors.length === 0 &&
    node.type === 'android.screenshot' &&
    (mode.mode === 'ABSOLUTE_PIXELS' || mode.mode === 'SCREEN_PERCENT')
  ) {
    return errors.concat(validateScreenshotRegion(node, nodeIndex, mode.mode));
  }
  return errors.concat(bindingErrors);
}
