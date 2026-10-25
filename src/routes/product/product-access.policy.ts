import { Inject, Injectable } from '@nestjs/common';
import { PermissionScope } from '../../shared/constants/role.constant.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { PublisherAccessPolicy } from '../publisher/publisher-access.policy.ts';
import type { ProductAccess } from './product-access.model.ts';
import { ProductAccessDeniedException } from './product.error.ts';
import { ProductRepo } from './product.repo.ts';

export type ProductOwnerAccess = {
  publisherAccountId: string;
};

@Injectable()
export class ProductAccessPolicy {
  constructor(
    @Inject(PublisherAccessPolicy) private readonly publisherAccessPolicy: PublisherAccessPolicy,
    @Inject(ProductRepo) private readonly productRepo: ProductRepo,
  ) {}

  resolveCreateAccess(userId: string): Promise<ProductOwnerAccess> {
    return this.publisherAccessPolicy.assertActivePublisher(userId);
  }

  // Unrestricted permission is not permission to edit another Publisher's draft.
  async resolveDraftSaveAccess(
    userId: string,
    scopes: ActivePermissionScope[],
  ): Promise<ProductOwnerAccess> {
    if (!scopes.includes(PermissionScope.OWN)) {
      throw ProductAccessDeniedException;
    }
    return this.publisherAccessPolicy.assertActivePublisher(userId);
  }

  // Reads deliberately skip the eligibility checks that mutations require: a blocked
  // former Publisher must still be able to inspect its own Product history. Null means
  // the caller owns no Publisher account, which lists answer with an empty page.
  async resolveReadAccess(
    userId: string,
    scopes: ActivePermissionScope[],
  ): Promise<ProductAccess | null> {
    if (scopes.includes(null)) {
      return { unrestricted: true };
    }
    if (!scopes.includes(PermissionScope.OWN)) {
      throw ProductAccessDeniedException;
    }

    const publisherAccount = await this.productRepo.getPublisherAccount(userId);
    return publisherAccount ? { unrestricted: false, publisherAccountId: publisherAccount.id } : null;
  }
}
