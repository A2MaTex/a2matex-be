import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { isUniqueConstraintPrismaError } from '../utils/prisma.ts';

@Catch()
/**
 * Final exception boundary for API requests. It maps unknown errors to 500 and
 * known Prisma unique constraint errors to 409 so clients receive an HTTP response.
 */
export class CatchEverythingFilter implements ExceptionFilter {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    // In certain situations `httpAdapter` might not be available in the
    // constructor method, thus we should resolve it here.
    const { httpAdapter } = this.httpAdapterHost;

    const ctx = host.switchToHttp();

    let httpStatus =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    let message =
      exception instanceof HttpException ? exception.getResponse() : 'Internal Server Error';
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
}
