import { Inject, Injectable } from '@nestjs/common';
import {
  PublisherAccountStatus,
  type PublisherAccountStatusType,
} from '../constants/publisher.constant.ts';
import { PermissionScope } from '../constants/role.constant.ts';
import type { ActivePermissionScope } from '../decorators/active-permission-scopes.decorator.ts';
import {
  ProjectAccessDeniedException,
  PublisherBlockedException,
  PublisherNotActivatedException,
} from '../errors/project-access.error.ts';
import type { ProjectAccess } from '../models/project-access.model.ts';
import { ProjectAccessRepo } from '../repositories/project-access.repo.ts';

type PublisherAccount = {
  id: string;
  status: PublisherAccountStatusType;
};

@Injectable()
export class ProjectAccessPolicy {
  constructor(@Inject(ProjectAccessRepo) private readonly projectAccessRepo: ProjectAccessRepo) {}

  async resolveReadAccess(
    userId: string,
    scopes: ActivePermissionScope[],
  ): Promise<ProjectAccess | null> {
    if (scopes.includes(null)) {
      return { unrestricted: true };
    }
    if (!scopes.includes(PermissionScope.OWN)) {
      throw ProjectAccessDeniedException;
    }

    const publisherAccount = await this.projectAccessRepo.getPublisherAccount(userId);
    return publisherAccount
      ? { unrestricted: false, publisherAccountId: publisherAccount.id }
      : null;
  }

  async resolveMutationAccess(
    userId: string,
    scopes: ActivePermissionScope[],
  ): Promise<ProjectAccess> {
    if (scopes.includes(null)) {
      return { unrestricted: true };
    }
    if (!scopes.includes(PermissionScope.OWN)) {
      throw ProjectAccessDeniedException;
    }

    const publisherAccount = await this.getActivePublisherAccount(userId);
    return { unrestricted: false, publisherAccountId: publisherAccount.id };
  }

  async resolveDraftSaveAccess(
    userId: string,
    scopes: ActivePermissionScope[],
  ): Promise<ProjectAccess> {
    if (!scopes.includes(PermissionScope.OWN)) {
      throw ProjectAccessDeniedException;
    }

    const publisherAccount = await this.getActivePublisherAccount(userId);
    return { unrestricted: false, publisherAccountId: publisherAccount.id };
  }

  async getActivePublisherAccount(userId: string): Promise<PublisherAccount> {
    const publisherAccount = await this.projectAccessRepo.getPublisherAccount(userId);
    if (!publisherAccount) {
      throw PublisherNotActivatedException;
    }
    if (publisherAccount.status === PublisherAccountStatus.BLOCKED) {
      throw PublisherBlockedException;
    }
    return publisherAccount;
  }
}
