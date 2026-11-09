import { z } from 'zod';
import { SWITCH_TYPE, switchRules } from './switch.validator.ts';
import { WORKFLOW_VALIDATION_DIAGNOSTIC_MESSAGES } from '../../../shared/constants/workflow-validation.constant.ts';
import type {
  EditorGraphType,
  WorkflowNodeDefinitionType,
  WorkflowValidationDiagnosticType,
} from '../workflow-validation.model.ts';

const name = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/);
const identifier = z.string().min(1).max(100);
const binding = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('literal'),
    value: z.union([z.string(), z.number().int(), z.boolean()]),
  }),
  z.strictObject({ kind: z.literal('workflowInput'), inputName: name }),
  z.strictObject({ kind: z.literal('nodeOutput'), nodeId: identifier, field: name }),
  z.strictObject({ kind: z.literal('flowVariable'), name }),
  z.strictObject({ kind: z.literal('globalVariable'), name }),
]);

const targeting = new Set(['android.tap', 'android.swipe', 'android.long_press']);

export function validateNodeBindings(
  graph: EditorGraphType,
  definitions: Map<string, WorkflowNodeDefinitionType>,
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
    if (!definition || targeting.has(node.type)) return;
    const isSet = node.type === 'flow.set_variable';
    const isWait = node.type === 'flow.wait_variable';
    const isSwitch = node.type === SWITCH_TYPE;
    const rules = isSwitch ? switchRules(node) : undefined;
    if (isSwitch && !rules) return;
    const switchFields = new Set([
      'value',
      ...[...(rules ?? [])].filter(([, operator]) => operator !== 'IS_EMPTY').map(([id]) => id),
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
    if (isSwitch)
      for (const field of switchFields) {
        if (!Object.hasOwn(node.bindings, field)) report(field);
      }
    for (const [field, raw] of Object.entries(node.bindings)) {
      if (isWait) {
        report(field);
        continue;
      }
      const kind = raw && typeof raw === 'object' && 'kind' in raw ? raw.kind : undefined;
      if (
        !isSet &&
        !isSwitch &&
        kind !== 'nodeOutput' &&
        kind !== 'flowVariable' &&
        kind !== 'globalVariable'
      )
        continue;
      const parsed = binding.safeParse(raw);
      const input = Object.hasOwn(definition.inputSchema?.properties ?? {}, field)
        ? definition.inputSchema?.properties[field]
        : undefined;
      if (
        !parsed.success ||
        (isSwitch ? !switchFields.has(field) : isSet ? field !== 'value' : !input)
      ) {
        report(field);
        continue;
      }
      if (parsed.data.kind === 'literal' && isSwitch) {
        types.set(
          field,
          typeof parsed.data.value === 'number' ? 'integer' : typeof parsed.data.value,
        );
      }
      if (parsed.data.kind !== 'nodeOutput') continue;
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
        types.set(field, outputType);
      }
    }
    const left = types.get('value');
    for (const [id, operator] of rules ?? []) {
      const right = types.get(id);
      if (operator === 'IS_EMPTY') {
        if (left && left !== 'string') report('value');
      } else if (operator === 'EQ' || operator === 'NE') {
        if (left && right && left !== right) report(id);
      } else {
        if (left && left !== 'integer') report('value');
        if (right && right !== 'integer') report(id);
      }
    }
  });
  return diagnostics;
}
