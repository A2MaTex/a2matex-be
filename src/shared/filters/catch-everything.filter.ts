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
};

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
    let message =
      exception instanceof HttpException
        ? this.normalizeExceptionMessage(exception.getResponse())
        : 'Internal Server Error';
    if (isUniqueConstraintPrismaError(exception)) {
      httpStatus = HttpStatus.CONFLICT;
      message = 'Record already exist';
    }
    const responseBody = {
      statusCode: httpStatus,
      message,
    };
    httpAdapter.reply(ctx.getResponse(), responseBody, httpStatus);
  }

  private normalizeExceptionMessage(response: string | object): unknown {
    if (typeof response === 'string') {
      return response;
    }

    const { message } = response as ExceptionResponse;
    if (Array.isArray(message)) {
      return message.map((item) => this.normalizeErrorItem(item));
    }

    return message ?? response;
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
