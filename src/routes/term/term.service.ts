import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CACHE_TTL_SECONDS,
  CURRENT_TERM_CACHE_PREFIX,
} from '../../shared/constants/cache.constant.ts';
import { TermStatus } from '../../shared/constants/publisher.constant.ts';
import type { TermTypeType } from '../../shared/constants/publisher.constant.ts';
import { DistributedLock } from '../../shared/decorators/distributed-lock.decorator.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { CacheKeyNotFoundError } from '../../shared/infrastructure/cache/cache.error.ts';
import { CACHE_PROVIDER } from '../../shared/infrastructure/cache/cache.interface.ts';
import type { CacheProvider } from '../../shared/infrastructure/cache/cache.interface.ts';
import { SUCCESS_RESPONSE } from '../../shared/models/response.model.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import { isUniqueConstraintPrismaError } from '../../shared/utils/prisma.ts';
import {
  ActiveTermConflictException,
  ActiveTermNotFoundException,
  InvalidTermStatusTransitionException,
  TermAlreadyExistsException,
  TermIsImmutableException,
  TermNotFoundException,
} from './term.error.ts';
import type {
  CreateTermInputType,
  CurrentTermOutputType,
  GetCurrentTermInputType,
  GetTermListInputType,
  UpdateTermInputType,
  UpdateTermStatusInputType,
} from './term.model.ts';
import { TermRepo } from './term.repo.ts';

type CachedCurrentTerm = Omit<CurrentTermOutputType, 'publishedAt'> & {
  publishedAt: string | null;
};

type UpdateTermStatusParams = {
  id: string;
  data: UpdateTermStatusInputType;
  userId: string;
};

type UpdateTermStatusByTypeParams = UpdateTermStatusParams & {
  type: TermTypeType;
};

@Injectable()
export class TermService {
  private readonly logger = new Logger(TermService.name);

  constructor(
    @Inject(TermRepo) private readonly termRepo: TermRepo,
    @Inject(CACHE_PROVIDER) private readonly cacheProvider: CacheProvider,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
  ) {}

  async getCurrent({ type }: GetCurrentTermInputType) {
    const cachedTerm = await this.getCachedCurrentTerm(type);
    if (cachedTerm) {
      return cachedTerm;
    }

    const term = await this.termRepo.getCurrent(type);
    if (!term) {
      throw ActiveTermNotFoundException;
    }

    await this.cacheProvider.SetStateObject(
      CURRENT_TERM_CACHE_PREFIX,
      type,
      term,
      CACHE_TTL_SECONDS.UNLIMITED,
    );
    return term;
  }

  getList(query: GetTermListInputType) {
    return this.termRepo.getList(query);
  }

  async getDetail(id: string) {
    const term = await this.termRepo.getById(id);
    if (!term) {
      throw TermNotFoundException;
    }

    return term;
  }

  async create({ data, userId }: { data: CreateTermInputType; userId: string }) {
    try {
      return await this.termRepo.create({ data, userId });
    } catch (error) {
      if (isUniqueConstraintPrismaError(error)) {
        throw TermAlreadyExistsException;
      }
      throw error;
    }
  }

  async update({ id, data, userId }: { id: string; data: UpdateTermInputType; userId: string }) {
    const term = await this.termRepo.getById(id);
    if (!term) {
      throw TermNotFoundException;
    }
    if (term.status !== TermStatus.DRAFT) {
      throw TermIsImmutableException;
    }

    const result = await this.termRepo.updateDraft({ id, data, userId });
    if (result.count === 0) {
      throw TermIsImmutableException;
    }
    return SUCCESS_RESPONSE;
  }

  async updateStatus(params: UpdateTermStatusParams) {
    const term = await this.termRepo.getStatusContext(params.id);
    if (!term) {
      throw TermNotFoundException;
    }

    return this.updateStatusByType({
      ...params,
      type: term.type,
    });
  }

  @DistributedLock({
    useCase: 'update_term_status',
    resource: ({ type }: UpdateTermStatusByTypeParams) => type,
  })
  @Transactional()
  private async updateStatusByType({
    id,
    type,
    data,
    userId,
  }: UpdateTermStatusByTypeParams) {
    const term = await this.termRepo.getStatusContext(id);
    if (!term || term.type !== type) {
      throw TermNotFoundException;
    }

    const now = new Date();
    try {
      if (data.status === TermStatus.ACTIVE) {
        if (term.status === TermStatus.ACTIVE) {
          throw InvalidTermStatusTransitionException;
        }

        await this.termRepo.archiveActiveByType({
          type: term.type,
          excludeId: term.id,
          userId,
          now,
        });
        await this.termRepo.updateStatus({
          id: term.id,
          status: TermStatus.ACTIVE,
          userId,
          now,
          publishedAt: now,
        });
      } else {
        if (term.status !== TermStatus.ACTIVE || !term.publishedAt) {
          throw InvalidTermStatusTransitionException;
        }
        await this.termRepo.updateStatus({
          id: term.id,
          status: TermStatus.ARCHIVED,
          userId,
          now,
          publishedAt: term.publishedAt,
        });
      }
    } catch (error) {
      if (isUniqueConstraintPrismaError(error)) {
        throw ActiveTermConflictException;
      }
      throw error;
    }

    await this.transactionService.afterCommit(async () => {
      this.logger.log(
        `Term status changed termId=${term.id} status=${data.status} actorId=${userId}`,
      );
      if (data.status === TermStatus.ACTIVE) {
        await this.cacheProvider.RemoveState(CURRENT_TERM_CACHE_PREFIX, term.type);
      }
    });
    return SUCCESS_RESPONSE;
  }

  private async getCachedCurrentTerm(type: GetCurrentTermInputType['type']) {
    try {
      const cachedTerm = await this.cacheProvider.GetStateObject<CachedCurrentTerm>(
        CURRENT_TERM_CACHE_PREFIX,
        type,
      );

      return {
        ...cachedTerm,
        publishedAt: cachedTerm.publishedAt ? new Date(cachedTerm.publishedAt) : null,
      };
    } catch (error) {
      if (!(error instanceof CacheKeyNotFoundError)) {
        throw error;
      }

      return null;
    }
  }
}
