import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client.js';

@Injectable()
export class TransactionContext {
  private readonly storage = new AsyncLocalStorage<Prisma.TransactionClient>();

  run<T>(client: Prisma.TransactionClient, callback: () => T): T {
    return this.storage.run(client, callback);
  }

  getClient(): Prisma.TransactionClient | undefined {
    return this.storage.getStore();
  }

  hasTransaction(): boolean {
    return Boolean(this.getClient());
  }
}
