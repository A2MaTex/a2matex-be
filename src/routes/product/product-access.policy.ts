import { Inject, Injectable } from '@nestjs/common';
import { PermissionScope } from '../../shared/constants/role.constant.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { PublisherAccessPolicy } from '../publisher/publisher-access.policy.ts';
import { ProductAccessDeniedException } from './product.error.ts';

export type ProductOwnerAccess = {
  publisherAccountId: string;
};

@Injectable()
export class ProductAccessPolicy {
  constructor(
    @Inject(PublisherAccessPolicy) private readonly publisherAccessPolicy: PublisherAccessPolicy,
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
}
