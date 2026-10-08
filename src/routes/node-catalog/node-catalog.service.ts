import { Inject, Injectable } from '@nestjs/common';
import { NodeCatalogRepo } from './node-catalog.repo.ts';
import type { GetNodeCatalogInputType, GetNodeCatalogOutputType } from './node-catalog.model.ts';
import { GetNodeCatalogOutput } from './node-catalog.model.ts';
import { isRuntimeVersionCompatible, sha256Hex } from './node-catalog.util.ts';
import { NodeDefinitionContract } from './node-definition.model.ts';

@Injectable()
export class NodeCatalogService {
  constructor(@Inject(NodeCatalogRepo) private readonly nodeCatalogRepo: NodeCatalogRepo) {}

  async getCatalog({ runtimeVersion }: GetNodeCatalogInputType): Promise<GetNodeCatalogOutputType> {
    const definitions = await this.nodeCatalogRepo.getActiveCatalog();
    const nodes = definitions
      .filter(({ minimumRuntimeVersion }) =>
        isRuntimeVersionCompatible(runtimeVersion, minimumRuntimeVersion),
      )
      .map(({ NodeDefinitionCapability, ...definition }) => {
        const capabilities = NodeDefinitionCapability.map(({ Capability }) => Capability);
        NodeDefinitionContract.parse({
          ...definition,
          capabilities: capabilities.map(({ code }) => code),
        });

        return {
          ...definition,
          capabilities,
        };
      });
    const output = {
      catalogHash: sha256Hex(nodes),
      nodes,
    };

    return GetNodeCatalogOutput.parse(output);
  }
}
