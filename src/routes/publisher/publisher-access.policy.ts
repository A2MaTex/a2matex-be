import { Inject, Injectable } from '@nestjs/common';
import { PublisherAccountStatus } from '../../shared/constants/publisher.constant.ts';
import { UserStatus } from '../../shared/constants/auth.constant.ts';
import {
  PublisherAccessDeniedException,
  PublisherBlockedException,
  PublisherNotActivatedException,
  PublisherTermsNotAcceptedException,
  PublisherUserNotActiveException,
} from './publisher.error.ts';
import { PublisherRepo } from './publisher.repo.ts';

@Injectable()
export class PublisherAccessPolicy {
  constructor(@Inject(PublisherRepo) private readonly publisherRepo: PublisherRepo) {}

  async assertActivePublisher(userId: string) {
    const state = await this.publisherRepo.getAccessState(userId);
    if (!state || state.status !== UserStatus.ACTIVE) {
      throw PublisherUserNotActiveException;
    }
    if (!state.publisherAccount || state.publisherAccount.deletedAt) {
      throw PublisherNotActivatedException;
    }
    if (state.publisherAccount.status === PublisherAccountStatus.BLOCKED) {
      throw PublisherBlockedException;
    }
    if (state.userRoles.length === 0) {
      throw PublisherAccessDeniedException;
    }
    if (state.publisherAccount.termsAcceptances.length === 0) {
      throw PublisherTermsNotAcceptedException;
    }

    return { publisherAccountId: state.publisherAccount.id };
  }
}
