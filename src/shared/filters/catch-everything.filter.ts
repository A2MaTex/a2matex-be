import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { isUniqueConstraintPrismaError } from '../utils/prisma.ts';

type ExceptionResponse = {
  message?: unknown;
  details?: unknown;
};

type SafeExceptionDetails = Record<string, string | number | boolean | null>;

@Catch()
/**
 * Final exception boundary for API requests. It maps unknown errors to 500 and
 * known Prisma unique constraint errors to 409 so clients receive an HTTP response.
 */
export class CatchEverythingFilter implements ExceptionFilter {
  constructor(@Inject(HttpAdapterHost) private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    // In certain situations `httpAdapter` might not be available in the
    // constructor method, thus we should resolve it here.
    const { httpAdapter } = this.httpAdapterHost;

    const ctx = host.switchToHttp();

    let httpStatus =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    let normalizedResponse =
      exception instanceof HttpException
        ? this.normalizeExceptionResponse(exception.getResponse())
        : { message: 'Internal Server Error' };
    if (isUniqueConstraintPrismaError(exception)) {
      httpStatus = HttpStatus.CONFLICT;
      normalizedResponse = { message: 'Record already exist' };
    }
    const responseBody = {
      statusCode: httpStatus,
      ...normalizedResponse,
    };
    httpAdapter.reply(ctx.getResponse(), responseBody, httpStatus);
  }

  private normalizeExceptionResponse(response: string | object): {
    message: unknown;
    details?: SafeExceptionDetails;
  } {
    if (typeof response === 'string') {
      return { message: response };
    }

    const { message, details } = response as ExceptionResponse;
    const normalizedMessage = Array.isArray(message)
      ? message.map((item) => this.normalizeErrorItem(item))
      : (message ?? response);

    return this.isSafeDetails(details)
      ? { message: normalizedMessage, details }
      : { message: normalizedMessage };
  }

  private isSafeDetails(details: unknown): details is SafeExceptionDetails {
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
      return false;
    }

    return Object.values(details).every(
      (value) =>
        value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value)),
    );
  }

  private normalizeErrorItem(item: unknown): unknown {
    if (!item || typeof item !== 'object') {
      return item;
    }

    const { message, path } = item as { message?: unknown; path?: unknown };
    return {
      message,
      path,
    };
  }
}
