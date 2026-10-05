import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { rm } from 'node:fs/promises';
import type { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

type RequestWithTemporaryFile = Request & {
  file?: {
    path?: string;
  };
};

@Injectable()
export class StaticUploadCleanupInterceptor implements NestInterceptor {
  private readonly logger = new Logger(StaticUploadCleanupInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithTemporaryFile>();

    return next.handle().pipe(
      finalize(() => {
        const temporaryFilePath = request.file?.path;
        if (!temporaryFilePath) {
          return;
        }

        void rm(temporaryFilePath, { force: true }).catch((error: unknown) => {
          this.logger.error(
            `Failed to remove temporary upload ${temporaryFilePath}`,
            error instanceof Error ? error.stack : undefined,
          );
        });
      }),
    );
  }
}
