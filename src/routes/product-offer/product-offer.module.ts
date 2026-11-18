import { Module } from '@nestjs/common';
import { ProductAccessPolicy } from '../product/product-access.policy.ts';
import { ProductRepo } from '../product/product.repo.ts';
import { PublisherModule } from '../publisher/publisher.module.ts';
import { ProductOfferController } from './product-offer.controller.ts';
import { ProductOfferRepo } from './product-offer.repo.ts';
import { ProductOfferService } from './product-offer.service.ts';

// Product imports this module for the activation contract, so it cannot be imported back.
// The Product ownership policy is provided directly, the way ProductReleaseModule does.
@Module({
  imports: [PublisherModule],
  controllers: [ProductOfferController],
  providers: [ProductOfferService, ProductOfferRepo, ProductAccessPolicy, ProductRepo],
  exports: [ProductOfferService],
})
export class ProductOfferModule {}
