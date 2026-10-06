import { Inject, Injectable, Logger } from '@nestjs/common';
import { DistributedLock } from '../../shared/decorators/distributed-lock.decorator.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { CACHE_PROVIDER } from '../../shared/infrastructure/cache/cache.interface.ts';
import type { CacheProvider } from '../../shared/infrastructure/cache/cache.interface.ts';
import { SUCCESS_RESPONSE } from '../../shared/models/response.model.ts';
import { StaticRepository } from '../../shared/repositories/static.repo.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import {
  ActiveLauncherReleaseNotFoundException,
  LauncherReleaseAlreadyActiveException,
  LauncherReleaseNotFoundException,
  LauncherReleaseStaticNotFoundException,
} from './launcher-release.error.ts';
import type {
  CreateLauncherReleaseInputType,
  GetLauncherReleaseListInputType,
  UpdateLauncherReleaseInputType,
} from './launcher-release.model.ts';
import { LauncherReleaseRepo } from './launcher-release.repo.ts';

@Injectable()
export class LauncherReleaseService {
  private readonly logger = new Logger(LauncherReleaseService.name);

  constructor(
    @Inject(LauncherReleaseRepo)
    private readonly launcherReleaseRepo: LauncherReleaseRepo,
    @Inject(StaticRepository)
    private readonly staticRepository: StaticRepository,
    @Inject(CACHE_PROVIDER)
    private readonly cacheProvider: CacheProvider,
    @Inject(TransactionService)
    private readonly transactionService: TransactionService,
  ) {}

  async getCurrent() {
    const release = await this.launcherReleaseRepo.getCurrent();
    if (!release) {
      throw ActiveLauncherReleaseNotFoundException;
    }

    return release;
  }

  getList(query: GetLauncherReleaseListInputType) {
    return this.launcherReleaseRepo.getList(query);
  }

  async getDetail(id: string) {
    const release = await this.launcherReleaseRepo.getById(id);
    if (!release) {
      throw LauncherReleaseNotFoundException;
    }
    return release;
  }

  async create(data: CreateLauncherReleaseInputType) {
    await this.assertStaticExists(data.staticId);
    return this.launcherReleaseRepo.create(data);
  }

  async update({ id, data }: { id: string; data: UpdateLauncherReleaseInputType }) {
    const release = await this.launcherReleaseRepo.getById(id);
    if (!release) {
      throw LauncherReleaseNotFoundException;
    }
    if (data.staticId) {
      await this.assertStaticExists(data.staticId);
    }

    await this.launcherReleaseRepo.update({ id, data });
    return SUCCESS_RESPONSE;
  }

  @DistributedLock({ useCase: 'activate_launcher_release' })
  @Transactional()
  async activate({ id, userId }: { id: string; userId: string }) {
    const release = await this.launcherReleaseRepo.getActivationContext(id);
    if (!release) {
      throw LauncherReleaseNotFoundException;
    }
    if (release.static.deletedAt) {
      throw LauncherReleaseStaticNotFoundException;
    }
    if (release.isActive) {
      throw LauncherReleaseAlreadyActiveException;
    }

    const now = new Date();
    await this.launcherReleaseRepo.deactivateCurrent({ excludeId: id, now });
    await this.launcherReleaseRepo.activate({
      id,
      now,
      publishedAt: release.publishedAt ?? now,
    });

    await this.transactionService.afterCommit(() => {
      this.logger.log(`Launcher release activated launcherReleaseId=${id} actorId=${userId}`);
    });
    return SUCCESS_RESPONSE;
  }

  private async assertStaticExists(staticId: string) {
    const staticRecord = await this.staticRepository.findById(staticId);
    if (!staticRecord) {
      throw LauncherReleaseStaticNotFoundException;
    }
  }
}
