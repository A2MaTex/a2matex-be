import { Inject, Injectable } from '@nestjs/common';
import {
  PublisherAccountStatus,
  type PublisherAccountStatusType,
} from '../../shared/constants/publisher.constant.ts';
import { PermissionScope } from '../../shared/constants/role.constant.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import {
  PublisherBlockedException,
  PublisherNotActivatedException,
} from '../publisher/publisher.error.ts';
import { ProjectAccessDeniedException } from './project.error.ts';
import type { ProjectAccess } from './project-access.model.ts';
import { ProjectRepo } from './project.repo.ts';

type PublisherAccount = {
  id: string;
  status: PublisherAccountStatusType;
};

@Injectable()
export class ProjectAccessPolicy {
  constructor(@Inject(ProjectRepo) private readonly projectRepo: ProjectRepo) {}

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

    const publisherAccount = await this.projectRepo.getPublisherAccount(userId);
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
    const publisherAccount = await this.projectRepo.getPublisherAccount(userId);
    if (!publisherAccount) {
      throw PublisherNotActivatedException;
    }
    if (publisherAccount.status === PublisherAccountStatus.BLOCKED) {
      throw PublisherBlockedException;
    }
    return publisherAccount;
  }
}
