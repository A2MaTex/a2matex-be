import { Module } from '@nestjs/common';
import { ProductReleasePackageService } from './services/product-release-package.service.ts';
import { ProjectReleaseService } from './services/product-release-build.service.ts';
import { ProductReleaseController } from './product-release.controller.ts';
import { ProductReleaseManagementController } from './product-release-management.controller.ts';
import { ProductReleaseManagementService } from './product-release.service.ts';
import { ProductReleaseManagementRepo } from './product-release.repo.ts';
import { KeyService } from '../../shared/services/key.service.ts';
import { ProductRepo } from '../product/product.repo.ts';
import { ProductAccessPolicy } from '../product/product-access.policy.ts';
import { PublisherModule } from '../publisher/publisher.module.ts';

@Module({
  imports: [PublisherModule],
  providers: [
    ProductReleasePackageService,
    ProjectReleaseService,
    KeyService,
    ProductRepo,
    ProductAccessPolicy,
    ProductReleaseManagementService,
    ProductReleaseManagementRepo,
  ],
  exports: [ProjectReleaseService],
  controllers: [ProductReleaseController, ProductReleaseManagementController],
})
export class ProductReleaseModule {}
