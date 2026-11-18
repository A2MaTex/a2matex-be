import { z } from 'zod';
import { WORKFLOW_VALIDATION_DIAGNOSTIC_MESSAGES as messages } from '../../../shared/constants/workflow-validation.constant.ts';
import type {
  EditorGraphType,
  WorkflowValidationDiagnosticType,
} from '../workflow-validation.model.ts';
import { MAX_SWITCH_RULES, SwitchOperator } from '../../node-catalog/node-catalog.constant.ts';

export const SWITCH_TYPE = 'flow.switch';
const unaryOperators = new Set<string>([
  SwitchOperator.IS_EMPTY,
  SwitchOperator.IS_NOT_EMPTY,
  SwitchOperator.IS_TRUE,
  SwitchOperator.IS_FALSE,
]);

export function switchOperatorRequiresOperand(operator: string): boolean {
  return !unaryOperators.has(operator);
}

const config = z.strictObject({
  rules: z
    .array(
      z.strictObject({
        id: z.uuid(),
        operator: z.enum(SwitchOperator),
      }),
    )
    .min(1)
    .max(MAX_SWITCH_RULES),
});

export function switchRules(node: EditorGraphType['nodes'][number]) {
  const parsed = config.safeParse(node.config);
  if (!parsed.success) return undefined;
  const rules = new Map(parsed.data.rules.map((rule) => [rule.id, rule.operator]));
  return rules.size === parsed.data.rules.length ? rules : undefined;
}

export function validateSwitches(graph: EditorGraphType, active: boolean) {
  const diagnostics: WorkflowValidationDiagnosticType[] = [];
  const instances = new Map<
    string,
    { ports: Set<string>; counts: Map<string, number>; index: number }
  >();
  if (!active) return { diagnostics, instances };
  graph.nodes.forEach((node, index) => {
    if (node.type !== SWITCH_TYPE) return;
    const rules = switchRules(node);
    if (!rules) {
      diagnostics.push({
        code: 'NODE_CONFIG_INVALID',
        message: messages.NODE_CONFIG_INVALID,
        nodeId: node.id,
        path: ['nodes', index, 'config', 'rules'],
      });
      return;
    }
    const ports = new Set([...rules.keys(), 'default']);
    if (node.errorPolicy === 'ERROR_BRANCH') ports.add('error');
    instances.set(node.id, { ports, counts: new Map(), index });
  });
  graph.edges.forEach((edge, index) => {
    const instance = instances.get(edge.sourceNodeId);
    if (!instance) return;
    if (!instance.ports.has(edge.sourcePort)) {
      diagnostics.push({
        code: 'EDGE_SOURCE_PORT_NOT_FOUND',
        message: messages.EDGE_SOURCE_PORT_NOT_FOUND,
        nodeId: edge.sourceNodeId,
        edgeId: edge.id,
        path: ['edges', index, 'sourcePort'],
      });
      return;
    }
    instance.counts.set(edge.sourcePort, (instance.counts.get(edge.sourcePort) ?? 0) + 1);
  });
  for (const [nodeId, instance] of instances) {
    for (const port of instance.ports) {
      if (instance.counts.get(port) === 1) continue;
      diagnostics.push({
        code: 'SWITCH_PORT_EDGE_COUNT_INVALID',
        message: messages.SWITCH_PORT_EDGE_COUNT_INVALID,
        nodeId,
        path: ['nodes', instance.index, 'ports', port],
      });
    }
  }
  return { diagnostics, instances };
}
