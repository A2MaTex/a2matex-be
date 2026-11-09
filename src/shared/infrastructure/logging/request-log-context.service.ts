import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { MAX_REQUEST_LOG_MESSAGES } from '../../constants/logging.constant.ts';
import type {
  CreateRequestLogContext,
  RequestLogContext,
  RequestLogLevel,
} from './request-log-context.ts';

@Injectable()
export class RequestLogContextService {
  private readonly storage = new AsyncLocalStorage<RequestLogContext>();

  createContext(input: CreateRequestLogContext): RequestLogContext {
    return {
      ...input,
      messages: [],
      finalized: false,
      messagesTruncated: false,
    };
  }

  run<T>(context: RequestLogContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  getContext(): RequestLogContext | undefined {
    return this.storage.getStore();
  }

  addMessage(level: RequestLogLevel, message: string, error?: unknown): void {
    const context = this.getMutableContext();
    if (!context) {
      return;
    }

    if (context.messages.length >= MAX_REQUEST_LOG_MESSAGES) {
      context.messagesTruncated = true;
    } else {
      context.messages.push({ level, message });
    }

    if (!context.rootError && error instanceof Error) {
      context.rootError = error;
    }
  }

  setUserId(userId: string): void {
    const context = this.getMutableContext();
    if (context) {
      context.userId = userId;
    }
  }

  recordFailure(statusCode: number, error?: unknown): void {
    const context = this.getMutableContext();
    if (!context) {
      return;
    }

    context.failureStatusCode = statusCode;
    if (error instanceof Error) {
      context.rootError = error;
    }
  }

  finalize(context: RequestLogContext | undefined = this.getContext()): boolean {
    if (!context || context.finalized) {
      return false;
    }

    context.finalized = true;
    return true;
  }

  isFinalized(context: RequestLogContext | undefined = this.getContext()): boolean {
    return context?.finalized ?? false;
  }

  private getMutableContext(): RequestLogContext | undefined {
    const context = this.getContext();
    return context && !context.finalized ? context : undefined;
  }
}
