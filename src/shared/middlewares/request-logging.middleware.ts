import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { TRACE_ID_HEADER } from '../constants/logging.constant.js';
import { ContextLoggerService } from '../infrastructure/logging/context-logger.service.js';
import { RequestLogContextService } from '../infrastructure/logging/request-log-context.service.js';
import type { RequestLogContext } from '../infrastructure/logging/request-log-context.js';

const CLIENT_CLOSED_REQUEST = 499;

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  constructor(
    @Inject(RequestLogContextService) private readonly contexts: RequestLogContextService,
    @Inject(ContextLoggerService) private readonly logger: ContextLoggerService,
  ) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const context: RequestLogContext = {
      traceId: randomBytes(16).toString('hex'),
      startedAt: performance.now(),
    };
    response.setHeader(TRACE_ID_HEADER, context.traceId);

    const finalize = () => {
      if (context.finalized) return;
      context.finalized = true;

      const statusCode =
        response.writableFinished || response.headersSent
          ? response.statusCode
          : (context.failureStatusCode ?? CLIENT_CLOSED_REQUEST);
      const route =
        typeof request.route?.path === 'string'
          ? request.baseUrl + request.route.path
          : request.path;

      this.logger.writeRequest(context, request.method, route, statusCode);
      context.messages = undefined;
      context.rootError = undefined;
      context.cause = undefined;
    };

    response.once('finish', finalize);
    response.once('close', finalize);
    this.contexts.run(context, next);
  }
}
