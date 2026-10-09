import { NodeDefinitionStatus } from '../../../generated/prisma/enums.ts';
import { PrismaService } from '../../../shared/services/prisma.service.ts';
import { NodeCatalogRepo } from '../node-catalog.repo.ts';

vi.mock('../../../shared/services/prisma.service.ts', () => ({
  PrismaService: class PrismaService {},
}));

describe('NodeCatalogRepo', () => {
  it('loads only active, non-deleted definitions and capability links', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prismaService = {
      getClient: () => ({ nodeDefinition: { findMany } }),
    } as unknown as PrismaService;
    const repository = new NodeCatalogRepo(prismaService);

    await repository.getActiveCatalog();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: NodeDefinitionStatus.ACTIVE,
          deletedAt: null,
        },
      }),
    );
    expect(findMany.mock.calls[0][0].select.NodeDefinitionCapability.where).toEqual({
      deletedAt: null,
      Capability: { deletedAt: null },
    });
  });
});
