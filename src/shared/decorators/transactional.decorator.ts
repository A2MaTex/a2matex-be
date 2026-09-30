import { TransactionOptions, TransactionService } from '../services/transaction.service.ts';

type TransactionalInstance = {
  transactionService?: Pick<TransactionService, 'runInTransaction'>;
};

type TransactionalMethod = (...args: any[]) => unknown;

export function Transactional(options?: TransactionOptions): MethodDecorator {
  return function (
    _target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): void {
    const originalMethod = descriptor.value as TransactionalMethod | undefined;
    if (!originalMethod) {
      return;
    }

    descriptor.value = function (this: TransactionalInstance, ...args: any[]) {
      if (!this.transactionService) {
        throw new Error(
          `@Transactional requires ${String(propertyKey)} to be declared on a class that injects TransactionService as transactionService`,
        );
      }

      return this.transactionService.runInTransaction(
        () => originalMethod.apply(this, args),
        options,
      );
    };
  };
}
