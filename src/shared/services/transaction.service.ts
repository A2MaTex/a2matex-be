import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
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

    return this.prismaService.$transaction(async (client) => {
      return this.transactionContext.run(client, async () => callback());
    }, options);
  }
}
