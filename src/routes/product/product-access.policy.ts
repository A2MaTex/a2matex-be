import { Inject, Injectable } from '@nestjs/common';
import {
  ProductLifecycleAction,
  type ProductLifecycleActionType,
} from '../../shared/constants/product.constant.ts';
import { PermissionScope } from '../../shared/constants/role.constant.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { PublisherAccessPolicy } from '../publisher/publisher-access.policy.ts';
import type { ProductAccess } from './product-access.model.ts';
import {
  ProductAccessDeniedException,
  ProductLifecycleActionDeniedException,
} from './product.error.ts';
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

  // The guard only proves the caller may reach the shared lifecycle route. Which
  // action they may ask for is decided here: an owner archives its own draft and
  // nothing else, while suspension and reactivation stay with unrestricted callers.
  async resolveLifecycleAccess(
    userId: string,
    scopes: ActivePermissionScope[],
    action: ProductLifecycleActionType,
  ): Promise<ProductAccess> {
    if (scopes.includes(null)) {
      return { unrestricted: true };
    }
    if (!scopes.includes(PermissionScope.OWN)) {
      throw ProductAccessDeniedException;
    }
    if (action !== ProductLifecycleAction.ARCHIVE) {
      throw ProductLifecycleActionDeniedException;
    }

    const { publisherAccountId } = await this.publisherAccessPolicy.assertActivePublisher(userId);
    return { unrestricted: false, publisherAccountId };
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
