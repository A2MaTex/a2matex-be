import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../../generated/prisma/client.ts';
import envConfig from '../config.ts';
import { TransactionContext } from '../infrastructure/database/transaction/transaction-context.ts';

const PRISMA_LOG_IGNORED_ENVIRONMENTS = ['production'];

export type PrismaClientOrTransaction = Prisma.TransactionClient | PrismaService;

@Injectable()
export class PrismaService extends PrismaClient {
  constructor(
    @Optional()
    @Inject(TransactionContext)
    private readonly transactionContext?: TransactionContext,
  ) {
    const loggingEnabled = !PRISMA_LOG_IGNORED_ENVIRONMENTS.includes(envConfig.NODE_ENV);
    const adapter = new PrismaPg({
      connectionString: envConfig.DATABASE_URL,
    });
    super({
      adapter,
      log: loggingEnabled ? [{ emit: 'event', level: 'query' }, 'info', 'error'] : [],
    });

    if (loggingEnabled) {
      const queryClient = this as PrismaClient<'query'>;
      queryClient.$on('query', (event) => {
        console.log(`prisma:query ${event.query}`);
        console.log(`prisma:params ${event.params}`);
      });
    }
  }

  getClient(): PrismaClientOrTransaction {
    return this.transactionContext?.getClient() ?? this;
  }
}
