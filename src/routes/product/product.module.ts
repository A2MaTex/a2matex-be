import { Module } from '@nestjs/common';
import { PublisherModule } from '../publisher/publisher.module.ts';
import { ProductController } from './product.controller.ts';
import { ProductRepo } from './product.repo.ts';
import { ProductService } from './product.service.ts';

@Module({
  imports: [PublisherModule],
  controllers: [ProductController],
  providers: [ProductService, ProductRepo],
})
export class ProductModule {}
