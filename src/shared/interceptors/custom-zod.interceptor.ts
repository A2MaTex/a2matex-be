import { CallHandler, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { ZodSerializationException, ZodSerializerInterceptor } from 'nestjs-zod';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable()
/**
 * Applies nestjs-zod response serialization and converts serialization failures
 * into HTTP exceptions that the global filters can format for clients.
 */
export class CustomZodSerializerInterceptor extends ZodSerializerInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return super.intercept(context, next).pipe(
      catchError((error: unknown) => {
        if (!(error instanceof ZodSerializationException)) {
          return throwError(() => error);
        }

        return throwError(
          () =>
            new HttpException(
              {
                message: 'Internal server error during response serialization',
                status: error.getStatus(),
              },
              error.getStatus(),
            ),
        );
      }),
    );
  }
}
