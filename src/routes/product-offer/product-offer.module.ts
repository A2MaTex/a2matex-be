import { Module } from '@nestjs/common';
import { ProductModule } from '../product/product.module.ts';
import { ProductOfferController } from './product-offer.controller.ts';
import { ProductOfferRepo } from './product-offer.repo.ts';
import { ProductOfferService } from './product-offer.service.ts';

@Module({
  imports: [ProductModule],
  controllers: [ProductOfferController],
  providers: [ProductOfferService, ProductOfferRepo],
})
export class ProductOfferModule {}
