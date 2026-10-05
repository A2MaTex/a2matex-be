import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.ts';
import { z } from 'zod';
import { UserStatus } from '../../shared/constants/auth.constant.ts';
import {
  ACCEPTANCE_METADATA_SCHEMA_VERSION,
  PublisherAccountStatus,
} from '../../shared/constants/publisher.constant.ts';
import { DistributedLock } from '../../shared/decorators/distributed-lock.decorator.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { CACHE_PROVIDER } from '../../shared/infrastructure/cache/cache.interface.ts';
import type { CacheProvider } from '../../shared/infrastructure/cache/cache.interface.ts';
import { SUCCESS_RESPONSE } from '../../shared/models/response.model.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import { NotFoundRecordException } from '../../shared/types/error.type.ts';
import {
  createPublisherProfileIncompleteException,
  PublicPublisherNotFoundException,
  PublisherAccountNotFoundException,
  PublisherAlreadyActivatedException,
  PublisherBlockedException,
  PublisherRoleUnavailableException,
  PublisherStatusConflictException,
  PublisherTermNotActiveException,
  PublisherUserNotActiveException,
} from './publisher.error.ts';
import type {
  ActivatePublisherInputType,
  GetPublisherListInputType,
  MissingPublisherProfileField,
  UpdatePublisherStatusInputType,
} from './publisher.model.ts';
import { PublisherRepo } from './publisher.repo.ts';

type AcceptanceContext = {
  ip: string;
  userAgent: string;
};

@Injectable()
export class PublisherService {
  private readonly logger = new Logger(PublisherService.name);

  constructor(
    @Inject(PublisherRepo) private readonly publisherRepo: PublisherRepo,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
    @Inject(CACHE_PROVIDER) private readonly cacheProvider: CacheProvider,
  ) {}

  async getMe(userId: string) {
    const [user, account, currentTerms] = await Promise.all([
      this.publisherRepo.getUserProfile(userId),
      this.publisherRepo.getAccountByUserId(userId),
      this.publisherRepo.getActivePublisherTerm(),
    ]);
    if (!user) {
      throw NotFoundRecordException;
    }

    const profile = user.profile?.deletedAt ? null : user.profile;
    const missingFields = this.getMissingProfileFields(profile);
    const acceptedCurrentTerms = Boolean(
      account &&
      currentTerms &&
      (await this.publisherRepo.hasAcceptedTerm({
        publisherAccountId: account.id,
        termId: currentTerms.id,
      })),
    );

    return {
      publisherAccount: account
        ? {
            id: account.id,
            status: account.status,
            activatedAt: account.activatedAt,
            blockedReason: account.blockedReason,
            blockedAt: account.blockedAt,
          }
        : null,
      missingFields,
      acceptedCurrentTerms,
      currentTerms,
      profile: profile
        ? {
            username: user.username,
            fullName: profile.fullName,
            email: profile.email,
            avatarStaticId: profile.avatarStaticId,
            bio: profile.bio,
            website: profile.website,
            twitter: profile.twitter,
            linkedin: profile.linkedin,
            github: profile.github,
            instagram: profile.instagram,
          }
        : null,
    };
  }

  @DistributedLock({
    useCase: 'activate_publisher',
    resource: ({ userId }: { userId: string }) => userId,
  })
  @Transactional()
  async activate({
    userId,
    data,
    context,
  }: {
    userId: string;
    data: ActivatePublisherInputType;
    context: AcceptanceContext;
  }) {
    const user = await this.publisherRepo.lockUser(userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw PublisherUserNotActiveException;
    }

    const profile = await this.publisherRepo.getUserProfile(userId);
    const missingFields = this.getMissingProfileFields(
      profile?.profile?.deletedAt ? null : profile?.profile,
    );
    if (missingFields.length > 0) {
      throw createPublisherProfileIncompleteException(missingFields);
    }

    const term = await this.publisherRepo.getActivePublisherTermById(data.termId);
    if (!term) {
      throw PublisherTermNotActiveException;
    }

    let account = await this.publisherRepo.getAccountByUserId(userId);
    if (account) {
      const lockedAccount = await this.publisherRepo.lockPublisherAccount(account.id);
      if (!lockedAccount) {
        throw PublisherAccountNotFoundException;
      }
      if (lockedAccount.status === PublisherAccountStatus.BLOCKED) {
        throw PublisherBlockedException;
      }

      const hasAcceptedCurrentTerm = await this.publisherRepo.hasAcceptedTerm({
        publisherAccountId: lockedAccount.id,
        termId: term.id,
      });
      if (hasAcceptedCurrentTerm) {
        throw PublisherAlreadyActivatedException;
      }
    }
    account ??= await this.publisherRepo.createAccount(userId);

    const role = await this.publisherRepo.getActivePublisherRole();
    if (!role) {
      throw PublisherRoleUnavailableException;
    }

    await this.publisherRepo.ensureAcceptance({
      publisherAccountId: account.id,
      termId: term.id,
      acceptanceMetadata: this.buildAcceptanceMetadata(context),
    });
    await this.publisherRepo.ensureUserRole({ userId, roleId: role.id });

    await this.transactionService.afterCommit(() => {
      this.logger.log(`Publisher activated userId=${userId} publisherAccountId=${account.id}`);
    });

    return SUCCESS_RESPONSE;
  }

  getList(query: GetPublisherListInputType) {
    return this.publisherRepo.getList(query);
  }

  async getDetail(id: string) {
    const publisher = await this.publisherRepo.getDetail(id);
    if (!publisher) {
      throw PublisherAccountNotFoundException;
    }
    return publisher;
  }

  @DistributedLock({
    useCase: 'update_publisher_status',
    resource: ({ id }: { id: string }) => id,
  })
  @Transactional()
  async updateStatus({
    id,
    data,
    actorId,
  }: {
    id: string;
    data: UpdatePublisherStatusInputType;
    actorId: string;
  }) {
    const existingAccount = await this.publisherRepo.getAccountById(id);
    if (!existingAccount) {
      throw PublisherAccountNotFoundException;
    }
    const user = await this.publisherRepo.lockUser(existingAccount.userId);
    if (!user) {
      throw PublisherAccountNotFoundException;
    }
    const account = await this.publisherRepo.lockPublisherAccount(id);
    if (!account) {
      throw PublisherAccountNotFoundException;
    }
    if (data.expectedStatus && data.expectedStatus !== account.status) {
      throw PublisherStatusConflictException;
    }
    if (data.status === account.status) {
      throw PublisherStatusConflictException;
    }

    if (data.status === PublisherAccountStatus.ACTIVE) {
      const role = await this.publisherRepo.getActivePublisherRole();
      if (!role) {
        throw PublisherRoleUnavailableException;
      }
      await this.publisherRepo.ensureUserRole({ userId: account.userId, roleId: role.id });
    }

    await this.publisherRepo.updateStatus({
      id,
      status: data.status,
      actorId,
      reason: data.reason,
    });
    await this.transactionService.afterCommit(() => {
      this.logger.log(
        `Publisher status changed publisherAccountId=${id} status=${data.status} actorId=${actorId}`,
      );
    });
    return SUCCESS_RESPONSE;
  }

  async getPublicProfile(username: string) {
    const publisher = await this.publisherRepo.getPublicByUsername(username);
    const profile = publisher?.user.profile;
    if (!publisher || !profile?.email) {
      throw PublicPublisherNotFoundException;
    }
    return {
      username: publisher.user.username,
      fullName: profile.fullName,
      email: profile.email,
      avatarStaticId: profile.avatarStaticId,
      bio: profile.bio,
      website: profile.website,
      twitter: profile.twitter,
      linkedin: profile.linkedin,
      github: profile.github,
      instagram: profile.instagram,
    };
  }

  private getMissingProfileFields(
    profile: { fullName: string; email: string | null } | null | undefined,
  ): MissingPublisherProfileField[] {
    const missingFields: MissingPublisherProfileField[] = [];
    if (!profile?.fullName.trim()) {
      missingFields.push('profile.fullName');
    }
    if (!profile?.email?.trim() || !z.email().safeParse(profile.email).success) {
      missingFields.push('profile.email');
    }
    return missingFields;
  }

  private buildAcceptanceMetadata(context: AcceptanceContext): Prisma.InputJsonObject {
    return {
      schemaVersion: ACCEPTANCE_METADATA_SCHEMA_VERSION,
      ip: context.ip,
      userAgent: context.userAgent || '',
    };
  }
}
