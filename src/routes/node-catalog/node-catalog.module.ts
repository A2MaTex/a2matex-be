import { Module } from '@nestjs/common';
import { NodeCatalogPublisherService } from './node-catalog-publisher.service.ts';
import { NodeCatalogController } from './node-catalog.controller.ts';
import { NodeCatalogRepo } from './node-catalog.repo.ts';
import { NodeCatalogService } from './node-catalog.service.ts';

@Module({
  controllers: [NodeCatalogController],
  providers: [NodeCatalogService, NodeCatalogPublisherService, NodeCatalogRepo],
  exports: [NodeCatalogPublisherService],
})
export class NodeCatalogModule {}
