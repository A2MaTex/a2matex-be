import { SWITCH_TYPE, switchOperatorRequiresOperand, switchRules } from './switch.validator.ts';
import {
  WorkflowBindingKind,
  WORKFLOW_VALIDATION_DIAGNOSTIC_MESSAGES,
} from '../../../shared/constants/workflow-validation.constant.ts';
import type {
  EditorGraphType,
  WorkflowNodeDefinitionType,
  WorkflowValidationDiagnosticType,
} from '../workflow-validation.model.ts';
import { EditorGraphBinding } from '../workflow-validation.model.ts';
import { isNodeFieldValueValid } from './node-config.validator.ts';
import {
  SetVariableBindingKindsContract,
  SwitchDynamicInputsContract,
} from '../../node-catalog/node-definition.model.ts';
import { SwitchOperator } from '../../node-catalog/node-catalog.constant.ts';

type InputSchema = NonNullable<WorkflowNodeDefinitionType['inputSchema']>;
type WorkflowBindingKindValue = (typeof WorkflowBindingKind)[keyof typeof WorkflowBindingKind];

function declaredBindingKinds(input: unknown): WorkflowBindingKindValue[] {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return [];
  const result = SetVariableBindingKindsContract.safeParse(
    (input as Record<string, unknown>).bindingKinds,
  );
  return result.success ? (Object.keys(result.data) as WorkflowBindingKindValue[]) : [];
}

function switchValueType(type: unknown): unknown {
  return type === 'integer' || type === 'number' ? 'number' : type;
}

export function validateNodeBindings(
  graph: EditorGraphType,
  definitions: Map<string, WorkflowNodeDefinitionType>,
  workflowInputSchema?: InputSchema,
): WorkflowValidationDiagnosticType[] {
  const diagnostics: WorkflowValidationDiagnosticType[] = [];
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = new Map<string, EditorGraphType['edges']>();
  for (const edge of graph.edges) {
    if (!nodes.has(edge.sourceNodeId) || !nodes.has(edge.targetNodeId)) continue;
    const outgoing = edges.get(edge.sourceNodeId) ?? [];
    outgoing.push(edge);
    edges.set(edge.sourceNodeId, outgoing);
  }
  const bypasses = new Map<string, Set<string>>();
  function reachableWithoutSuccess(producer: string): Set<string> {
    const cached = bypasses.get(producer);
    if (cached) return cached;
    const seen = new Set([graph.entryNodeId]);
    const pending = [graph.entryNodeId];
    for (const current of pending) {
      for (const edge of edges.get(current) ?? []) {
        if (current === producer && edge.sourcePort === 'success') continue;
        if (seen.has(edge.targetNodeId)) continue;
        seen.add(edge.targetNodeId);
        pending.push(edge.targetNodeId);
      }
    }
    bypasses.set(producer, seen);
    return seen;
  }

  graph.nodes.forEach((node, index) => {
    const definition = definitions.get(node.type);
    if (!definition || definition.editorHints?.targeting) return;
    const isSet = node.type === 'flow.set_variable';
    const isWait = node.type === 'flow.wait_variable';
    const isSwitch = node.type === SWITCH_TYPE;
    const rules = isSwitch ? switchRules(node) : undefined;
    if (isSwitch && !rules) return;
    const switchDynamicInputs = isSwitch
      ? SwitchDynamicInputsContract.safeParse(definition.inputSchema?.dynamicInputs)
      : undefined;
    const switchFields = new Set([
      'value',
      ...[...(rules ?? [])]
        .filter(([, operator]) => switchOperatorRequiresOperand(operator))
        .map(([id]) => id),
    ]);
    const types = new Map<string, unknown>();
    const reported = new Set<string>();
    const report = (field: string) => {
      if (reported.has(field)) return;
      reported.add(field);
      diagnostics.push({
        code: 'NODE_VALUE_BINDING_INVALID',
        message: WORKFLOW_VALIDATION_DIAGNOSTIC_MESSAGES.NODE_VALUE_BINDING_INVALID,
        nodeId: node.id,
        path: ['nodes', index, 'bindings', field],
      });
    };
    if (isSet && !Object.hasOwn(node.bindings, 'value')) report('value');
    if (!isSet && !isWait && !isSwitch) {
      for (const field of definition.inputSchema?.required ?? []) {
        if (!Object.hasOwn(node.bindings, field)) report(field);
      }
    }
    if (isSwitch)
      for (const field of switchFields) {
        if (!Object.hasOwn(node.bindings, field)) report(field);
      }
    for (const [field, raw] of Object.entries(node.bindings)) {
      if (isWait) {
        report(field);
        continue;
      }
      const parsed = EditorGraphBinding.safeParse(raw);
      const input = Object.hasOwn(definition.inputSchema?.properties ?? {}, field)
        ? definition.inputSchema?.properties[field]
        : undefined;
      const allowedBindingKinds = isSet
        ? declaredBindingKinds(input)
        : isSwitch
          ? field === 'value'
            ? declaredBindingKinds(input)
            : switchDynamicInputs?.success
              ? (Object.keys(
                  switchDynamicInputs.data.ruleOperand.bindingKinds,
                ) as WorkflowBindingKindValue[])
              : []
          : definition.editorHints.bindingKinds;
      if (
        !parsed.success ||
        (parsed.success && !allowedBindingKinds?.includes(parsed.data.kind)) ||
        (isSwitch ? !switchFields.has(field) : isSet ? field !== 'value' : !input)
      ) {
        report(field);
        continue;
      }
      if (parsed.data.kind === WorkflowBindingKind.LITERAL) {
        if (!isSet && !isSwitch && input && !isNodeFieldValueValid(parsed.data.value, input)) {
          report(field);
        }
        if (isSwitch) {
          types.set(field, typeof parsed.data.value);
        }
        continue;
      }
      if (parsed.data.kind === WorkflowBindingKind.WORKFLOW_INPUT) {
        if (!workflowInputSchema) continue;
        const workflowInput = workflowInputSchema.properties[parsed.data.inputName];
        const requiredInput = workflowInputSchema.required.includes(parsed.data.inputName);
        const requiredDestination = definition.inputSchema?.required.includes(field) ?? false;
        if (
          !workflowInput ||
          (!isSet && !isSwitch && input?.type !== workflowInput.type) ||
          (requiredDestination && !requiredInput)
        ) {
          report(field);
        } else if (isSwitch) {
          types.set(field, switchValueType(workflowInput.type));
        }
        continue;
      }
      if (parsed.data.kind !== WorkflowBindingKind.NODE_OUTPUT) continue;
      const { nodeId, field: outputField } = parsed.data;
      const producer = nodes.get(nodeId);
      const output = producer && definitions.get(producer.type)?.outputSchema;
      const outputType =
        output?.required.includes(outputField) && output.properties[outputField]?.type;
      if (
        !outputType ||
        (!isSet && !isSwitch && input?.type !== outputType) ||
        nodeId === node.id ||
        reachableWithoutSuccess(nodeId).has(node.id)
      ) {
        report(field);
      } else if (isSwitch) {
        types.set(field, switchValueType(outputType));
      }
    }
    const left = types.get('value');
    for (const [id, operator] of rules ?? []) {
      const right = types.get(id);
      if (operator === SwitchOperator.IS_EMPTY || operator === SwitchOperator.IS_NOT_EMPTY) {
        if (left && left !== 'string') report('value');
      } else if (operator === SwitchOperator.IS_TRUE || operator === SwitchOperator.IS_FALSE) {
        if (left && left !== 'boolean') report('value');
      } else if (operator === SwitchOperator.EQ || operator === SwitchOperator.NE) {
        if (left && right && left !== right) report(id);
      } else if (
        operator === SwitchOperator.CONTAINS ||
        operator === SwitchOperator.NOT_CONTAINS ||
        operator === SwitchOperator.STARTS_WITH ||
        operator === SwitchOperator.ENDS_WITH
      ) {
        if (left && left !== 'string') report('value');
        if (right && right !== 'string') report(id);
      } else {
        if (left && left !== 'number') report('value');
        if (right && right !== 'number') report(id);
      }
    }
  });
  return diagnostics;
}
