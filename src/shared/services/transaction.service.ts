import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type {
  AfterCommitCallback,
  TransactionStore,
} from '../infrastructure/database/transaction/transaction-context.ts';
import { TransactionContext } from '../infrastructure/database/transaction/transaction-context.ts';
import { PrismaService } from './prisma.service.ts';

export type TransactionOptions = {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
};

@Injectable()
export class TransactionService {
  constructor(
    @Inject(PrismaService) private readonly prismaService: PrismaService,
    @Inject(TransactionContext) private readonly transactionContext: TransactionContext,
  ) {}

  runInTransaction<T>(callback: () => T | Promise<T>, options?: TransactionOptions): Promise<T> {
    if (this.transactionContext.hasTransaction()) {
      return Promise.resolve(callback());
    }

    const afterCommitCallbacks: AfterCommitCallback[] = [];

    return this.prismaService
      .$transaction(async (client) => {
        const store: TransactionStore = {
          client,
          afterCommitCallbacks,
        };
        return this.transactionContext.run(store, async () => callback());
      }, options)
      .then(async (result) => {
        await this.runAfterCommitCallbacks(afterCommitCallbacks);
        return result;
      });
  }

  async afterCommit(callback: AfterCommitCallback): Promise<void> {
    if (!this.transactionContext.hasTransaction()) {
      await callback();
      return;
    }

    this.transactionContext.addAfterCommit(callback);
  }

  private async runAfterCommitCallbacks(callbacks: AfterCommitCallback[]): Promise<void> {
    for (const callback of callbacks) {
      await callback();
    }
  }
}
