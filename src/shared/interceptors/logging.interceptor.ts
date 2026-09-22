import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { isUniqueConstraintPrismaError } from '../utils/prisma.ts';

@Injectable()
/**
 * Logs controller/service exceptions with details. Request lifecycle logs live
 * in RequestLoggingMiddleware so guard failures are logged too.
 */
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const startedAt = Date.now();
    const { method, originalUrl } = request;

    return next.handle().pipe(
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
