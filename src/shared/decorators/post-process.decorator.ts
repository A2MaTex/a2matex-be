import { Logger } from '@nestjs/common';
import type { TransactionService } from '../services/transaction.service.ts';

export type PostProcessContext<Result = unknown, Args extends unknown[] = unknown[]> = {
  result: Result;
  args: Args;
};

export type PostProcessHandlerName = string | symbol;

export type PostProcessOptions = {
  handlers: PostProcessHandlerName[];
  failOnError?: boolean;
};

type PostProcessInstance = {
  transactionService?: Pick<TransactionService, 'afterCommit'>;
  [key: string | symbol]: unknown;
};

type PostProcessMethod = (...args: any[]) => unknown;

const logger = new Logger('PostProcess');

export function PostProcess(options: PostProcessOptions): MethodDecorator {
  validatePostProcessOptions(options);
  return function (
    _target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): void {
    const originalMethod = descriptor.value as PostProcessMethod | undefined;
    if (!originalMethod) {
      return;
    }

    descriptor.value = async function (this: PostProcessInstance, ...args: any[]) {
      const result = await originalMethod.apply(this, args);
      const runHandlers = () =>
        runPostProcessHandlers({
          instance: this,
          sourceMethod: propertyKey,
          options,
          context: {
            result,
            args,
          },
        });

      if (this.transactionService) {
        await this.transactionService.afterCommit(runHandlers);
      } else {
        await runHandlers();
      }

      return result;
    };
  };
}

function validatePostProcessOptions(options: PostProcessOptions): void {
  if (options.handlers.length === 0) {
    throw new Error('@PostProcess requires at least one handler');
  }
}

async function runPostProcessHandlers({
  instance,
  sourceMethod,
  options,
  context,
}: {
  instance: PostProcessInstance;
  sourceMethod: string | symbol;
  options: PostProcessOptions;
  context: PostProcessContext<unknown, any[]>;
}) {
  for (const handlerName of options.handlers) {
    const handler = instance[handlerName];
    if (typeof handler !== 'function') {
      throw new Error(
        `@PostProcess handler ${String(handlerName)} does not exist on ${instance.constructor.name}`,
      );
    }

    try {
      await handler.call(instance, context);
    } catch (error) {
      if (options.failOnError === true) {
        throw error;
      }

      logger.error(
        `Post-process handler ${String(handlerName)} failed after ${String(sourceMethod)}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
