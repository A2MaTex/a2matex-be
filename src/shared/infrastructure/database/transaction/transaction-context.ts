import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client.js';

export type AfterCommitCallback = () => void | Promise<void>;

export type TransactionStore = {
  client: Prisma.TransactionClient;
  afterCommitCallbacks: AfterCommitCallback[];
};

@Injectable()
export class TransactionContext {
  private readonly storage = new AsyncLocalStorage<TransactionStore>();

  run<T>(store: TransactionStore, callback: () => T): T {
    return this.storage.run(store, callback);
  }

  getClient(): Prisma.TransactionClient | undefined {
    return this.storage.getStore()?.client;
  }

  hasTransaction(): boolean {
    return Boolean(this.getClient());
  }

  addAfterCommit(callback: AfterCommitCallback): void {
    this.storage.getStore()?.afterCommitCallbacks.push(callback);
  }
}
