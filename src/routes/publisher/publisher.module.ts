import { Module } from '@nestjs/common';
import { MarketplacePublisherController } from './marketplace-publisher.controller.ts';
import { PublisherAccessPolicy } from './publisher-access.policy.ts';
import { PublisherController } from './publisher.controller.ts';
import { PublisherRepo } from './publisher.repo.ts';
import { PublisherService } from './publisher.service.ts';

@Module({
  controllers: [PublisherController, MarketplacePublisherController],
  providers: [PublisherService, PublisherRepo, PublisherAccessPolicy],
  exports: [PublisherAccessPolicy],
})
export class PublisherModule {}
