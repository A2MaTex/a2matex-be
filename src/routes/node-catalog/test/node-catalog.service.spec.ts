import { BASIC_NODE_DEFINITIONS } from '../definitions/basic-node-definitions.ts';
import { NodeCatalogRepo } from '../node-catalog.repo.ts';
import { GetNodeCatalogOutput } from '../node-catalog.model.ts';
import { NodeCatalogService } from '../node-catalog.service.ts';

vi.mock('../node-catalog.repo.ts', () => ({
  NodeCatalogRepo: class NodeCatalogRepo {},
}));

function storedDefinition(type: string, minimumRuntimeVersion: string) {
  const definition = BASIC_NODE_DEFINITIONS.find((item) => item.type === type)!;
  const { capabilities, ...fields } = definition;

  return {
    ...fields,
    minimumRuntimeVersion,
    NodeDefinitionCapability: capabilities.map((code) => ({
      Capability: {
        code,
        name: code,
        description: code,
        isSensitive: true,
      },
    })),
  };
}

describe('NodeCatalogService', () => {
  it('returns only definitions supported by the requested Runtime version', async () => {
    const getActiveCatalog = vi
      .fn()
      .mockResolvedValue([
        storedDefinition('android.tap', '0.1.0'),
        storedDefinition('android.screenshot', '0.2.0'),
      ]);
    const service = new NodeCatalogService({ getActiveCatalog } as unknown as NodeCatalogRepo);

    const result = await service.getCatalog({ runtimeVersion: '0.1.0' });

    expect(result.nodes.map(({ type }) => type)).toEqual(['android.tap']);
    expect(GetNodeCatalogOutput.safeParse(result).success).toBe(true);
  });

  it('returns a stable hash for unchanged catalog content', async () => {
    const getActiveCatalog = vi.fn().mockResolvedValue([storedDefinition('android.tap', '0.1.0')]);
    const service = new NodeCatalogService({ getActiveCatalog } as unknown as NodeCatalogRepo);

    const first = await service.getCatalog({ runtimeVersion: '0.1.0' });
    const second = await service.getCatalog({ runtimeVersion: '0.1.0' });

    expect(first.catalogHash).toBe(second.catalogHash);
  });
});
