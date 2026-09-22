import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

@Injectable()
/**
 * Logs every HTTP request at the middleware layer, before guards run, so
 * rejected requests still produce request/response logs.
 */
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestLoggingMiddleware.name);

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = Date.now();
    const { method, originalUrl, ip } = request;
    const userAgentHeader = request.headers['user-agent'];
    const userAgent = Array.isArray(userAgentHeader)
      ? userAgentHeader.join(',')
      : (userAgentHeader ?? '');

    this.logger.log(`Incoming request ${method} ${originalUrl} ip=${ip} userAgent="${userAgent}"`);

    response.on('finish', () => {
      const message = `Completed request ${method} ${originalUrl} status=${response.statusCode} duration=${Date.now() - startedAt}ms`;

      if (response.statusCode >= 500) {
        this.logger.error(message);
        return;
      }

      if (response.statusCode >= 400) {
        this.logger.warn(message);
        return;
      }

      this.logger.log(message);
    });

    next();
  }
}
