import { HttpException, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { TRACE_ID_HEADER } from '../constants/logging.constant.ts';
import { ContextLoggerService } from '../infrastructure/logging/context-logger.service.ts';
import { LogSanitizer } from '../infrastructure/logging/log-sanitizer.ts';
import { RequestLogContextService } from '../infrastructure/logging/request-log-context.service.ts';
import type {
  RequestLogContext,
  RequestLogSeverity,
  StructuredRequestLogRecord,
} from '../infrastructure/logging/request-log-context.ts';
import { buildRequestLogMessage } from '../infrastructure/logging/request-log-formatter.ts';

@Injectable()
/**
 * Creates request correlation before guards run and owns the exactly-once
 * structured completion record.
 */
export class RequestLoggingMiddleware implements NestMiddleware {
  constructor(
    private readonly requestContext: RequestLogContextService,
    private readonly logger: ContextLoggerService,
    private readonly sanitizer: LogSanitizer,
  ) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const context = this.requestContext.createContext({
      traceId: randomBytes(16).toString('hex'),
      method: request.method,
      route: this.getFallbackRoute(request),
      startedAt: Date.now(),
    });

    response.setHeader(TRACE_ID_HEADER, context.traceId);

    const finalize = () => this.finalizeRequest(request, response, context);
    response.once('finish', finalize);
    response.once('close', finalize);

    this.requestContext.run(context, next);
  }

  private finalizeRequest(request: Request, response: Response, context: RequestLogContext): void {
    if (this.requestContext.isFinalized(context)) {
      return;
    }

    context.route = this.getMatchedRoute(request) ?? context.route;
    context.failureStatusCode =
      response.statusCode >= 400 ? response.statusCode : context.failureStatusCode;

    if (!this.requestContext.finalize(context)) {
      return;
    }

    const record: StructuredRequestLogRecord = {
      timestamp: new Date().toISOString(),
      severity: this.getSeverity(context, response.statusCode),
      traceId: context.traceId,
      method: context.method,
      route: context.route,
      statusCode: response.statusCode,
      durationMs: Math.max(0, Date.now() - context.startedAt),
      message: buildRequestLogMessage(context, this.sanitizer),
    };

    if (context.userId) {
      record.userId = context.userId;
    }
    if (context.rootError && this.isOperationalFailure(context, response.statusCode)) {
      record.error = {
        name: this.sanitizer.sanitizeMessage(context.rootError.name),
        stack: this.sanitizer.sanitizeStack(context.rootError.stack),
      };
    }

    this.logger.writeRequestRecord(record);
  }

  private getSeverity(context: RequestLogContext, statusCode: number): RequestLogSeverity {
    if (this.isOperationalFailure(context, statusCode)) {
      return 'ERROR';
    }
    return statusCode >= 400 ? 'WARNING' : 'INFO';
  }

  private isOperationalFailure(context: RequestLogContext, statusCode: number): boolean {
    if (statusCode >= 500 || context.messages.some(({ level }) => level === 'error')) {
      return true;
    }
    if (!context.rootError) {
      return false;
    }

    return !(statusCode >= 400 && context.rootError instanceof HttpException);
  }

  private getMatchedRoute(request: Request): string | undefined {
    const routePath = request.route?.path;
    if (typeof routePath !== 'string') {
      return undefined;
    }

    const baseUrl = request.baseUrl === '/' ? '' : request.baseUrl;
    return this.joinRouteParts(baseUrl, routePath);
  }

  private getFallbackRoute(request: Request): string {
    const queryStart = request.originalUrl.indexOf('?');
    const pathname =
      queryStart === -1 ? request.originalUrl : request.originalUrl.slice(0, queryStart);
    return pathname || '/';
  }

  private joinRouteParts(baseUrl: string, routePath: string): string {
    const left = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const right = routePath.startsWith('/') ? routePath : `/${routePath}`;
    return `${left}${right}` || '/';
  }
}
