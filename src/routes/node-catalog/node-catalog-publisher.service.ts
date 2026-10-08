import { Inject, Injectable, Logger } from '@nestjs/common';
import { BASIC_NODE_DEFINITIONS } from './definitions/basic-node-definitions.ts';
import { CAPABILITY_DEFINITIONS } from './definitions/capability-definitions.ts';
import { NodeCatalogRepo } from './node-catalog.repo.ts';
import { sha256Hex } from './node-catalog.util.ts';

@Injectable()
export class NodeCatalogPublisherService {
  private readonly logger = new Logger(NodeCatalogPublisherService.name);

  constructor(@Inject(NodeCatalogRepo) private readonly nodeCatalogRepo: NodeCatalogRepo) {}

  async publish() {
    const knownCapabilityCodes = new Set(CAPABILITY_DEFINITIONS.map(({ code }) => code));
    const missingCapabilityCodes = [
      ...new Set(
        BASIC_NODE_DEFINITIONS.flatMap(({ capabilities }) => capabilities).filter(
          (code) => !knownCapabilityCodes.has(code),
        ),
      ),
    ];
    if (missingCapabilityCodes.length > 0) {
      throw new Error(`Missing capability definitions: ${missingCapabilityCodes.join(', ')}`);
    }

    const result = await this.nodeCatalogRepo.syncCatalog({
      capabilities: CAPABILITY_DEFINITIONS,
      definitions: BASIC_NODE_DEFINITIONS.map((definition) => ({
        ...definition,
        contentHash: sha256Hex(definition),
      })),
    });

    this.logger.log(
      `Node catalog synchronized created=${result.created} updated=${result.updated} unchanged=${result.unchanged} disabled=${result.disabled}`,
    );
    return result;
  }
}
