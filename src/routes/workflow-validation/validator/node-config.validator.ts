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

type ConfigSchema = WorkflowNodeDefinitionType['configSchema'];
type FieldSchema = ConfigSchema['properties'][string];

function configDiagnostic(
  node: EditorGraphType['nodes'][number],
  nodeIndex: number,
  field?: string,
): WorkflowValidationDiagnosticType {
  // Point Studio to the exact field, but do not echo the rejected value or internal schema. This
  // keeps diagnostics useful without leaking credentials or large user-authored config payloads.
  return {
    code: WorkflowValidationDiagnosticCode.NODE_CONFIG_INVALID,
    message:
      WORKFLOW_VALIDATION_DIAGNOSTIC_MESSAGES[WorkflowValidationDiagnosticCode.NODE_CONFIG_INVALID],
    nodeId: node.id,
    path: ['nodes', nodeIndex, 'config', ...(field === undefined ? [] : [field])],
  };
}

function isNumberConstraintSatisfied(
  value: number,
  schema: Record<string, Prisma.JsonValue>,
): boolean {
  // An omitted bound means "unbounded" on that side. The catalog controls these schema values, so
  // invalid non-number bounds are ignored rather than applied through JavaScript coercion.
  return (
    (typeof schema.minimum !== 'number' || value >= schema.minimum) &&
    (typeof schema.maximum !== 'number' || value <= schema.maximum)
  );
}

function isStringConstraintSatisfied(
  value: string,
  schema: Record<string, Prisma.JsonValue>,
): boolean {
  // Cheap length checks run before the regular expression. Patterns are system-owned Node Catalog
  // data, not user-supplied expressions from the graph request.
  if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
    return false;
  }
  if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
    return false;
  }
  return typeof schema.pattern !== 'string' || new RegExp(schema.pattern).test(value);
}

/**
 * Validates the deliberately small schema language published by Node Catalog.
 * Bindings are excluded: Phase 8 will validate values supplied by previous nodes.
 */
function isConfigValueValid(value: Prisma.JsonValue, schema: FieldSchema): boolean {
  // This switch is the complete MVP config-schema interpreter. Unsupported schema types fail
  // closed, preventing the backend from silently accepting a value it cannot validate.
  switch (schema.type) {
    case 'string':
      return typeof value === 'string' && isStringConstraintSatisfied(value, schema);
    case 'integer':
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        isNumberConstraintSatisfied(value, schema)
      );
    case 'number':
      return typeof value === 'number' && isNumberConstraintSatisfied(value, schema);
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return false;
  }
}

export function validateNodeConfig(
  node: EditorGraphType['nodes'][number],
  nodeIndex: number,
  schema: ConfigSchema,
): WorkflowValidationDiagnosticType[] {
  const diagnostics: WorkflowValidationDiagnosticType[] = [];

  // Config pass 1 - report every required field absent from the node. Object.hasOwn distinguishes
  // a missing field from a present false, zero, or empty-string value.
  new Set(schema.required).forEach((field) => {
    if (!Object.hasOwn(node.config, field)) {
      diagnostics.push(configDiagnostic(node, nodeIndex, field));
    }
  });

  // Config pass 2 - validate every supplied field. A field missing from schema.properties is an
  // additional property and is rejected by the same field-level diagnostic as a type/range error.
  Object.entries(node.config).forEach(([field, value]) => {
    const fieldSchema = schema.properties[field];
    if (!fieldSchema || !isConfigValueValid(value, fieldSchema)) {
      diagnostics.push(configDiagnostic(node, nodeIndex, field));
    }
  });

  return diagnostics;
}
