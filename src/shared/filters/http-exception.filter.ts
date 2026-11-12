import { Catch, Inject, HttpException, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { RequestLogContextService } from '../infrastructure/logging/request-log-context.service.js';

@Catch(HttpException)
export class HttpExceptionFilter extends BaseExceptionFilter {
  constructor(
    @Inject(HttpAdapterHost) { httpAdapter }: HttpAdapterHost,
    @Inject(RequestLogContextService) private readonly requestLogs: RequestLogContextService,
  ) {
    super(httpAdapter);
  }

  catch(exception: HttpException, host: ArgumentsHost) {
    this.requestLogs.recordFailure(exception, exception.getStatus());
    super.catch(exception, host);
  }
}
