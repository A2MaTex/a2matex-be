import { readFileSync } from 'node:fs';
import { BASIC_NODE_DEFINITIONS } from '../definitions/basic-node-definitions.ts';
import { NodeDefinitionCatalogContract, NodeDefinitionContract } from '../node-definition.model.ts';

const readFixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../test/fixtures/node-catalog/${name}`, import.meta.url),
      'utf8',
    ),
  );

describe('NodeDefinitionContract', () => {
  it('accepts the representative valid JSON fixture', () => {
    expect(NodeDefinitionContract.safeParse(readFixture('valid-flow-start.json')).success).toBe(
      true,
    );
  });

  it('rejects the representative invalid JSON fixture', () => {
    const result = NodeDefinitionContract.safeParse(
      readFixture('invalid-missing-runtime-version.json'),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(({ path }) => path.join('.') === 'minimumRuntimeVersion'),
      ).toBe(true);
    }
  });

  it('validates all 15 predefined authoring nodes', () => {
    const result = NodeDefinitionCatalogContract.parse(BASIC_NODE_DEFINITIONS);

    expect(result).toHaveLength(15);
    expect(new Set(result.map(({ type }) => type)).size).toBe(15);
  });

  it('publishes binding kinds for Studio authoring', () => {
    const definitions = new Map(
      BASIC_NODE_DEFINITIONS.map((definition) => [definition.type, definition]),
    );

    expect(definitions.get('flow.start')?.editorHints.bindingKinds).toBeUndefined();
    expect(definitions.get('android.tap')?.editorHints.bindingKinds).toEqual(['LITERAL']);
    expect(definitions.get('android.input_text')?.editorHints.bindingKinds).toEqual([
      'LITERAL',
      'WORKFLOW_INPUT',
      'NODE_OUTPUT',
      'FLOW_VARIABLE',
      'GLOBAL_VARIABLE',
    ]);
    expect(definitions.get('flow.switch')?.editorHints.bindingKinds).toBeUndefined();
  });

  it('publishes the self-contained Set Variable authoring contract', () => {
    const definition = BASIC_NODE_DEFINITIONS.find(({ type }) => type === 'flow.set_variable');

    expect(definition?.configSchema.properties.scope).toEqual({
      type: 'string',
      enum: ['FLOW', 'RUN_GROUP'],
      default: 'FLOW',
    });
    expect(definition?.configSchema.required).toEqual(['name', 'scope']);
    expect(definition?.inputSchema.properties.value?.bindingKinds).toEqual({
      LITERAL: { fields: { value: { types: ['string', 'number', 'boolean'] } } },
      WORKFLOW_INPUT: { fields: ['inputName'] },
      NODE_OUTPUT: { fields: ['nodeId', 'field'] },
      FLOW_VARIABLE: { fields: ['name'] },
      GLOBAL_VARIABLE: { fields: ['name'] },
    });
    expect(definition?.inputSchema.required).toEqual(['value']);
    expect(definition?.editorHints).toEqual({});
  });

  it('publishes the self-contained Switch authoring contract', () => {
    const definition = BASIC_NODE_DEFINITIONS.find(({ type }) => type === 'flow.switch');

    expect(definition?.configSchema.required).toEqual(['rules']);
    expect(definition?.inputSchema.required).toEqual(['value']);
    expect(definition?.inputSchema.properties.value?.bindingKinds).toBeDefined();
    expect(definition?.inputSchema.dynamicInputs).toEqual({
      ruleOperand: {
        bindingKeyFrom: 'config.rules[].id',
        operandCountFrom: 'config.rules[].operator',
        bindingKinds: definition?.inputSchema.properties.value?.bindingKinds,
      },
    });
    expect(definition?.outputPorts).toEqual({
      ports: ['default', 'error'],
      dynamicPorts: { keysFrom: 'config.rules[].id' },
    });
    expect(definition?.editorHints).toEqual({});
  });

  it('publishes only workflow-consumable Android outputs', () => {
    const definitions = new Map(
      BASIC_NODE_DEFINITIONS.map((definition) => [definition.type, definition]),
    );
    const emptyOutputTypes = [
      'android.launch_app',
      'android.tap',
      'android.swipe',
      'android.input_text',
      'android.press_back',
      'android.press_home',
    ];

    emptyOutputTypes.forEach((type) => {
      expect(definitions.get(type)?.outputSchema).toEqual({
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      });
    });
    expect(definitions.get('android.screenshot')?.outputSchema).toEqual({
      type: 'object',
      properties: {
        artifactId: {
          type: 'string',
          minLength: 1,
        },
      },
      required: ['artifactId'],
      additionalProperties: false,
    });
  });

  it('rejects duplicate node types', () => {
    const duplicate = structuredClone(BASIC_NODE_DEFINITIONS[0]);

    expect(
      NodeDefinitionCatalogContract.safeParse([...BASIC_NODE_DEFINITIONS, duplicate]).success,
    ).toBe(false);
  });

  it('rejects removed node-level version metadata', () => {
    expect(
      NodeDefinitionContract.safeParse({
        ...structuredClone(BASIC_NODE_DEFINITIONS[0]),
        version: 1,
      }).success,
    ).toBe(false);
  });

  it('allows omitted binding kinds and rejects duplicates', () => {
    const definition = structuredClone(BASIC_NODE_DEFINITIONS[0]);

    expect(
      NodeDefinitionContract.safeParse({
        ...definition,
        editorHints: {},
      }).success,
    ).toBe(true);
    expect(
      NodeDefinitionContract.safeParse({
        ...definition,
        editorHints: { bindingKinds: ['LITERAL', 'LITERAL'] },
      }).success,
    ).toBe(false);
  });

  it('rejects a Set Variable definition without its value binding contract', () => {
    const setVariable = structuredClone(
      BASIC_NODE_DEFINITIONS.find(({ type }) => type === 'flow.set_variable')!,
    );

    setVariable.inputSchema.properties = {};
    setVariable.inputSchema.required = [];

    expect(NodeDefinitionContract.safeParse(setVariable).success).toBe(false);
  });
});
