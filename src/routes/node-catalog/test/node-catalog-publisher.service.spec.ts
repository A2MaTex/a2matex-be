import { BASIC_NODE_DEFINITIONS } from '../definitions/basic-node-definitions.ts';
import { NodeCatalogPublisherService } from '../node-catalog-publisher.service.ts';
import { NodeCatalogRepo } from '../node-catalog.repo.ts';

vi.mock('../node-catalog.repo.ts', () => ({
  NodeCatalogRepo: class NodeCatalogRepo {},
}));

describe('NodeCatalogPublisherService', () => {
  it('publishes all definitions with deterministic content hashes', async () => {
    const syncCatalog = vi.fn().mockResolvedValue({
      created: 11,
      updated: 0,
      unchanged: 0,
      disabled: 0,
    });
    const service = new NodeCatalogPublisherService({ syncCatalog } as unknown as NodeCatalogRepo);

    await expect(service.publish()).resolves.toEqual({
      created: 11,
      updated: 0,
      unchanged: 0,
      disabled: 0,
    });

    const payload = syncCatalog.mock.calls[0][0];
    expect(payload.definitions).toHaveLength(11);
    expect(payload.capabilities).toHaveLength(2);
    payload.definitions.forEach(({ contentHash }: { contentHash: string }) => {
      expect(contentHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  it('rejects an unknown capability before starting repository synchronization', async () => {
    const syncCatalog = vi.fn();
    const service = new NodeCatalogPublisherService({ syncCatalog } as unknown as NodeCatalogRepo);
    const definition = BASIC_NODE_DEFINITIONS.find(({ type }) => type === 'android.tap')!;
    const originalCapabilities = [...definition.capabilities];

    try {
      (definition.capabilities as string[]).push('android.missing.capability');

      await expect(service.publish()).rejects.toThrow(
        'Missing capability definitions: android.missing.capability',
      );
      expect(syncCatalog).not.toHaveBeenCalled();
    } finally {
      definition.capabilities.splice(0, definition.capabilities.length, ...originalCapabilities);
    }
  });
});
