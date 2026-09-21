import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { isUniqueConstraintPrismaError } from '../utils/prisma.ts';

@Injectable()
/**
 * Logs incoming API requests and their completion time without logging bodies,
 * headers, or tokens.
 */
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();
    const startedAt = Date.now();
    const { method, originalUrl, ip } = request;
    const userAgent = request.headers['user-agent'] ?? '';

    this.logger.log(`Incoming request ${method} ${originalUrl} ip=${ip} userAgent="${userAgent}"`);

    return next.handle().pipe(
      tap(() => {
        this.logger.log(
          `Completed request ${method} ${originalUrl} status=${response.statusCode} duration=${Date.now() - startedAt}ms`,
        );
      }),
      catchError((error: unknown) => {
        const statusCode = this.getErrorStatusCode(error);
        const errorDetail = this.getErrorDetail(error);

        this.logger.error(
          `Failed request ${method} ${originalUrl} status=${statusCode} duration=${Date.now() - startedAt}ms error=${errorDetail}`,
          error instanceof Error ? error.stack : undefined,
        );
        return throwError(() => error);
      }),
    );
  }

  private getErrorStatusCode(error: unknown) {
    if (error instanceof HttpException) {
      return error.getStatus();
    }

    if (isUniqueConstraintPrismaError(error)) {
      return HttpStatus.CONFLICT;
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private getErrorDetail(error: unknown) {
    if (error instanceof HttpException) {
      return this.stringifyErrorResponse(error.getResponse());
    }

    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }

    return this.stringifyErrorResponse(error);
  }

  private stringifyErrorResponse(response: unknown) {
    if (typeof response === 'string') {
      return response;
    }

    try {
      return JSON.stringify(response);
    } catch {
      return 'Unserializable error response';
    }
  }
}
