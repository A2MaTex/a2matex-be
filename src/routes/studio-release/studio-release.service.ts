import { Inject, Injectable, Logger } from '@nestjs/common';
import { DistributedLock } from '../../shared/decorators/distributed-lock.decorator.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { CACHE_PROVIDER } from '../../shared/infrastructure/cache/cache.interface.ts';
import type { CacheProvider } from '../../shared/infrastructure/cache/cache.interface.ts';
import { SUCCESS_RESPONSE } from '../../shared/models/response.model.ts';
import { StaticRepository } from '../../shared/repositories/static.repo.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import { isNotFoundPrismaError, isUniqueConstraintPrismaError } from '../../shared/utils/prisma.ts';
import {
  ActiveStudioReleaseNotFoundException,
  StudioReleaseActiveNotEditableException,
  StudioReleaseAlreadyActiveException,
  StudioReleaseNotActiveException,
  StudioReleaseNotFoundException,
  StudioReleaseStaticNotFoundException,
  StudioReleaseVersionTakenException,
} from './studio-release.error.ts';
import type {
  CreateStudioReleaseInputType,
  GetStudioReleaseListInputType,
  UpdateStudioReleaseInputType,
} from './studio-release.model.ts';
import { StudioReleaseRepo } from './studio-release.repo.ts';

@Injectable()
export class StudioReleaseService {
  private readonly logger = new Logger(StudioReleaseService.name);

  constructor(
    @Inject(StudioReleaseRepo)
    private readonly studioReleaseRepo: StudioReleaseRepo,
    @Inject(StaticRepository)
    private readonly staticRepository: StaticRepository,
    // @DistributedLock và @Transactional đọc hai thuộc tính này lúc chạy, tên là hợp đồng.
    @Inject(CACHE_PROVIDER)
    private readonly cacheProvider: CacheProvider,
    @Inject(TransactionService)
    private readonly transactionService: TransactionService,
  ) {}

  async getCurrent() {
    const release = await this.studioReleaseRepo.getCurrent();
    if (!release) {
      throw ActiveStudioReleaseNotFoundException;
    }

    return release;
  }

  getList(query: GetStudioReleaseListInputType) {
    return this.studioReleaseRepo.getList(query);
  }

  async getDetail(id: string) {
    const release = await this.studioReleaseRepo.getById(id);
    if (!release) {
      throw StudioReleaseNotFoundException;
    }
    return release;
  }

  async create({ data, userId }: { data: CreateStudioReleaseInputType; userId: string }) {
    await this.assertStaticExists(data.staticId);

    const release = await this.runCatchingWriteConflict(() => this.studioReleaseRepo.create(data));
    this.logger.log(
      `Studio release created studioReleaseId=${release.id} version=${data.version} actorId=${userId}`,
    );
    return release;
  }

  // Khoá chung với activate: không có khoá thì một activate xen giữa lúc đọc isActive và lúc ghi
  // sẽ cho đổi version/staticId của bản vừa thành hiệu lực, đúng thứ FR-016 cấm.
  @DistributedLock({ useCase: 'activate_studio_release' })
  @Transactional()
  async update({
    id,
    data,
    userId,
  }: {
    id: string;
    data: UpdateStudioReleaseInputType;
    userId: string;
  }) {
    const release = await this.studioReleaseRepo.getEditContext(id);
    if (!release) {
      throw StudioReleaseNotFoundException;
    }
    if (release.isActive && (data.version !== undefined || data.staticId !== undefined)) {
      throw StudioReleaseActiveNotEditableException;
    }
    if (data.staticId) {
      await this.assertStaticExists(data.staticId);
    }

    await this.runCatchingWriteConflict(() => this.studioReleaseRepo.update({ id, data }));

    await this.transactionService.afterCommit(() => {
      this.logger.log(`Studio release updated studioReleaseId=${id} actorId=${userId}`);
    });
    return SUCCESS_RESPONSE;
  }

  @DistributedLock({ useCase: 'activate_studio_release' })
  @Transactional()
  async activate({ id, userId }: { id: string; userId: string }) {
    const release = await this.studioReleaseRepo.getActivationContext(id);
    if (!release) {
      throw StudioReleaseNotFoundException;
    }
    if (release.static.deletedAt) {
      throw StudioReleaseStaticNotFoundException;
    }
    if (release.isActive) {
      throw StudioReleaseAlreadyActiveException;
    }

    const now = new Date();
    await this.runCatchingWriteConflict(async () => {
      await this.studioReleaseRepo.deactivateCurrent({ excludeId: id, now });
      await this.studioReleaseRepo.activate({
        id,
        now,
        publishedAt: release.publishedAt ?? now,
      });
    });

    await this.transactionService.afterCommit(() => {
      this.logger.log(`Studio release activated studioReleaseId=${id} actorId=${userId}`);
    });
    return SUCCESS_RESPONSE;
  }

  // Dùng chung useCase với activate: thiếu `resource` nên khoá là chính useCase, tức một
  // mutex toàn bảng — đúng thứ bất biến "nhiều nhất một bản hiệu lực" cần.
  @DistributedLock({ useCase: 'activate_studio_release' })
  @Transactional()
  async deactivate({ id, userId }: { id: string; userId: string }) {
    const release = await this.studioReleaseRepo.getEditContext(id);
    if (!release) {
      throw StudioReleaseNotFoundException;
    }
    if (!release.isActive) {
      throw StudioReleaseNotActiveException;
    }

    await this.runCatchingWriteConflict(() =>
      this.studioReleaseRepo.deactivate({ id, now: new Date() }),
    );

    await this.transactionService.afterCommit(() => {
      this.logger.log(`Studio release deactivated studioReleaseId=${id} actorId=${userId}`);
    });
    return SUCCESS_RESPONSE;
  }

  private async runCatchingWriteConflict<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (isUniqueConstraintPrismaError(error)) {
        // Partial unique index trên isActive chỉ bị chạm khi khoá phân tán đã hỏng;
        // meta.target cho biết đụng ràng buộc nào để thông điệp không vô nghĩa.
        throw this.isActiveConstraintError(error)
          ? StudioReleaseAlreadyActiveException
          : StudioReleaseVersionTakenException;
      }
      // Bản ghi biến mất giữa lúc đọc và lúc ghi: 404 chứ không phải 500.
      if (isNotFoundPrismaError(error)) {
        throw StudioReleaseNotFoundException;
      }
      throw error;
    }
  }

  private isActiveConstraintError(error: { meta?: { target?: unknown } }): boolean {
    const target = error.meta?.target;
    const text = Array.isArray(target) ? target.join(',') : String(target ?? '');
    return text.includes('isActive');
  }

  private async assertStaticExists(staticId: string) {
    const staticRecord = await this.staticRepository.findById(staticId);
    if (!staticRecord) {
      throw StudioReleaseStaticNotFoundException;
    }
  }
}
