import { Module } from '@nestjs/common';
import { ProductOfferModule } from '../product-offer/product-offer.module.ts';
import { ProductReleaseModule } from '../product-release/product-release.module.ts';
import { PublisherModule } from '../publisher/publisher.module.ts';
import { ProductAccessPolicy } from './product-access.policy.ts';
import { ProductController } from './product.controller.ts';
import { ProductRepo } from './product.repo.ts';
import { ProductService } from './product.service.ts';

@Module({
  // Activation readiness comes from both collaborators; neither imports Product back.
  imports: [PublisherModule, ProductOfferModule, ProductReleaseModule],
  controllers: [ProductController],
  providers: [ProductService, ProductAccessPolicy, ProductRepo],
  // Submission reuses the Static media-eligibility rule instead of copying it.
  exports: [ProductRepo, ProductAccessPolicy],
})
export class ProductModule {}
