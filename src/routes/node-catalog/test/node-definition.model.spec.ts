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

  it('validates all 11 predefined MVP nodes', () => {
    const result = NodeDefinitionCatalogContract.parse(BASIC_NODE_DEFINITIONS);

    expect(result).toHaveLength(11);
    expect(new Set(result.map(({ type }) => type)).size).toBe(11);
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
});
