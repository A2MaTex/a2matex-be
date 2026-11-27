import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import envConfig from '../../shared/config.ts';
import { SharedUserRepository } from '../../shared/repositories/shared-user.repo.ts';
import type { LauncherProductListOutputType } from './launcher.model.ts';
import { LauncherRepo } from './launcher.repo.ts';

@Injectable()
export class LauncherService {
  private readonly logger = new Logger(LauncherService.name);

  constructor(
    @Inject(LauncherRepo) private readonly launcherRepo: LauncherRepo,
    @Inject(SharedUserRepository) private readonly sharedUserRepo: SharedUserRepository,
  ) {}

  async getProductList(userId: string): Promise<LauncherProductListOutputType> {
    const hasCustomer = await this.sharedUserRepo.hasActiveCustomer(userId);
    if (!hasCustomer) {
      this.logger.warn(
        `Launcher product list rejected: no active Customer account userId=${userId}`,
      );
      throw new ForbiddenException('Error.CustomerAccountRequired');
    }

    const items = await this.launcherRepo.listForCustomer(userId, envConfig.API_PREFIX);
    return { items };
  }
}
