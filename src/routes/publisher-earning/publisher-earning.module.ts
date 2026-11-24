import { Module } from '@nestjs/common';
import { PublisherEarningController } from './publisher-earning.controller.ts';
import { PublisherEarningRepo } from './publisher-earning.repo.ts';
import { PublisherEarningService } from './publisher-earning.service.ts';

// Reads the seller's side of the same Orders the Order module writes. Kept separate
// because it serves a different role with a different access rule.
@Module({
  controllers: [PublisherEarningController],
  providers: [PublisherEarningService, PublisherEarningRepo],
})
export class PublisherEarningModule {}
