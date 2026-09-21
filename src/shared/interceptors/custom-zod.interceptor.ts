import { CallHandler, ExecutionContext, HttpException, Injectable } from '@nestjs/common'
import { ZodSerializerInterceptor } from 'nestjs-zod'
import { Observable } from 'rxjs'
import { catchError } from 'rxjs/operators'

@Injectable()
/**
 * Applies nestjs-zod response serialization and converts serialization failures
 * into HTTP exceptions that the global filters can format for clients.
 */
export class CustomZodSerializerInterceptor extends ZodSerializerInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return super.intercept(context, next).pipe(
      catchError((error) => {
        throw new HttpException(
          {
            message: error.response?.message || 'Internal server error during response serialization',
            error: error.response,
            status: error.status || 500,
          },
          error.status || 500,
        )
      }),
    )
  }
}
