import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../../generated/prisma/client.ts';
import envConfig from '../config.ts';
import { TransactionContext } from '../infrastructure/database/transaction/transaction-context.ts';

export type PrismaClientOrTransaction = Prisma.TransactionClient | PrismaService;

@Injectable()
export class PrismaService extends PrismaClient {
  constructor(
    @Optional()
    @Inject(TransactionContext)
    private readonly transactionContext?: TransactionContext,
  ) {
    const adapter = new PrismaPg({
      connectionString: envConfig.DATABASE_URL,
    });
    super({ adapter, log: ['info'] });
  }

  getClient(): PrismaClientOrTransaction {
    return this.transactionContext?.getClient() ?? this;
  }
}
