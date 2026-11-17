import { Injectable, type HttpException } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestLogContext } from './request-log-context.js';

const exceptionLogMessages = new WeakMap<Error, string>();

export function withRequestLogMessage<T extends HttpException>(exception: T, message: string): T {
  exceptionLogMessages.set(exception, message);
  return exception;
}

@Injectable()
export class RequestLogContextService {
  private readonly storage = new AsyncLocalStorage<RequestLogContext>();

  run(context: RequestLogContext, next: () => void): void {
    this.storage.run(context, next);
  }

  get current(): RequestLogContext | undefined {
    return this.storage.getStore();
  }

  recordFailure(exception: unknown, statusCode: number): void {
    const context = this.current;
    if (!context || context.finalized) return;

    context.failureStatusCode = statusCode;
    if (exception instanceof Error) {
      context.rootError ??= exception;
      context.cause ??= exceptionLogMessages.get(exception);
    }
  }
}
