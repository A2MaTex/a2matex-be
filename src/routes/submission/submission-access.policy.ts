import { Inject, Injectable } from '@nestjs/common';
import { PermissionScope } from '../../shared/constants/role.constant.ts';
import type { ActivePermissionScope } from '../../shared/decorators/active-permission-scopes.decorator.ts';
import { PublisherAccessPolicy } from '../publisher/publisher-access.policy.ts';
import type { SubmissionAccess } from './submission-access.model.ts';
import { SubmissionAccessDeniedException } from './submission.error.ts';
import { SubmissionRepo } from './submission.repo.ts';

export type SubmissionOwnerAccess = {
  publisherAccountId: string;
};

@Injectable()
export class SubmissionAccessPolicy {
  constructor(
    @Inject(PublisherAccessPolicy) private readonly publisherAccessPolicy: PublisherAccessPolicy,
    @Inject(SubmissionRepo) private readonly submissionRepo: SubmissionRepo,
  ) {}

  // Admin unrestricted access to a Product is not permission to submit on a
  // Publisher's behalf, so create resolves an active Publisher and nothing else.
  resolveCreateAccess(userId: string): Promise<SubmissionOwnerAccess> {
    return this.publisherAccessPolicy.assertActivePublisher(userId);
  }

  // Reads skip the eligibility checks create requires: a blocked former Publisher
  // must still see its own Submission history. Null means the caller owns no
  // Publisher account, which lists answer with an empty page.
  async resolveReadAccess(
    userId: string,
    scopes: ActivePermissionScope[],
  ): Promise<SubmissionAccess | null> {
    if (scopes.includes(null)) {
      return { unrestricted: true };
    }
    if (!scopes.includes(PermissionScope.OWN)) {
      throw SubmissionAccessDeniedException;
    }

    const publisherAccount = await this.submissionRepo.getPublisherAccount(userId);
    return publisherAccount
      ? { unrestricted: false, publisherAccountId: publisherAccount.id }
      : null;
  }

  // Scan recovery is an operational route: a Publisher may neither call it nor infer
  // that it exists.
  resolveScanRetryAccess(scopes: ActivePermissionScope[]): void {
    if (!scopes.includes(null)) {
      throw SubmissionAccessDeniedException;
    }
  }
}
