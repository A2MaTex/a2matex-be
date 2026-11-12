import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import {
  MAX_LOG_MESSAGE_BYTES,
  MAX_REQUEST_LOG_MESSAGES,
} from '../../constants/logging.constant.js';
import { RequestLogContextService } from './request-log-context.service.js';
import type { LogSeverity, RequestLogContext } from './request-log-context.js';

function limitText(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;

  const suffix = '…';
  let end = Math.min(text.length, maxBytes - Buffer.byteLength(suffix));
  while (Buffer.byteLength(text.slice(0, end)) > maxBytes - Buffer.byteLength(suffix)) {
    end = Math.floor(end / 2);
  }
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return text.slice(0, end) + suffix;
}

@Injectable()
export class ContextLoggerService implements LoggerService {
  constructor(
    @Inject(RequestLogContextService) private readonly contexts: RequestLogContextService,
  ) {}

  log(message: unknown): void {
    this.record('INFO', message);
  }

  warn(message: unknown): void {
    this.record('WARNING', message);
  }

  error(message: unknown, error?: unknown): void {
    this.record('ERROR', message, error);
  }

  // Passing the original error.message here explicitly opts into logging that text.
  errorWithCause(message: string, error: Error, cause: string): void {
    this.record('ERROR', message, error, limitText(cause, MAX_LOG_MESSAGE_BYTES));
  }

  debug(message: unknown): void {
    this.record('DEBUG', message);
  }

  verbose(message: unknown): void {
    this.debug(message);
  }

  fatal(message: unknown, error?: unknown): void {
    this.record('CRITICAL', message, error);
  }

  writeRequest(
    context: RequestLogContext,
    method: string,
    route: string,
    statusCode: number,
  ): void {
    const failed = statusCode >= 400 || context.hasOperationalError;
    const severity = failed ? 'ERROR' : 'INFO';
    const messages = context.messages;
    let message = 'request completed';
    if (failed || messages?.length) {
      if (failed) messages?.reverse();
      message = [
        failed ? undefined : 'request completed',
        ...(messages ?? []),
        context.truncated ? '[messages truncated]' : undefined,
        failed ? context.cause : undefined,
      ]
        .filter(Boolean)
        .join(': ');
      if (!message) {
        message = (statusCode >= 400 ? STATUS_CODES[statusCode] : undefined) ?? 'request failed';
      }
    }

    this.write(severity, {
      traceId: context.traceId,
      method,
      route,
      statusCode,
      durationMs: Math.round(performance.now() - context.startedAt),
      error:
        severity === 'ERROR' && context.rootError
          ? limitText(context.rootError.name, MAX_LOG_MESSAGE_BYTES)
          : undefined,
      userId: context.userId,
      message,
    });
  }

  private record(
    severity: LogSeverity,
    message: unknown,
    exception?: unknown,
    cause?: string,
  ): void {
    const context = this.contexts.current;
    if (context?.finalized) return;

    const error =
      exception instanceof Error ? exception : message instanceof Error ? message : undefined;
    const isError = severity === 'ERROR' || severity === 'CRITICAL';
    if (context) {
      if (isError) {
        context.hasOperationalError = true;
        context.rootError ??= error;
        context.cause ??= cause;
      }
      if (severity === 'DEBUG') return;
      const messages = (context.messages ??= []);
      if (messages.length >= MAX_REQUEST_LOG_MESSAGES) {
        context.truncated = true;
        return;
      }
      messages.push(
        limitText(
          typeof message === 'string' ? message : 'diagnostic message',
          MAX_LOG_MESSAGE_BYTES,
        ),
      );
      return;
    }

    const text = limitText(
      typeof message === 'string' ? message : 'diagnostic message',
      MAX_LOG_MESSAGE_BYTES,
    );
    this.write(severity, {
      error: error ? limitText(error.name, MAX_LOG_MESSAGE_BYTES) : undefined,
      message: cause ? text + ': ' + cause : text,
    });
  }

  private write(severity: LogSeverity, fields: object): void {
    process.stdout.write(
      JSON.stringify({ timestamp: new Date().toISOString(), severity, ...fields }) + '\n',
    );
  }
}
