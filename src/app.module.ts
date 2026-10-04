import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './routes/auth/auth.module.js';
import { PermissionModule } from './routes/permission/permission.module.js';
import { ProfileModule } from './routes/profile/profile.module.ts';
import { PublisherModule } from './routes/publisher/publisher.module.ts';
import { RoleModule } from './routes/role/role.module.ts';
import { TermModule } from './routes/term/term.module.ts';
import { CatchEverythingFilter } from './shared/filters/catch-everything.filter.js';
import { HttpExceptionFilter } from './shared/filters/http-exception.filter.js';
import { AuthenticationGuard } from './shared/guards/authentication.guard.js';
import { CustomZodSerializerInterceptor } from './shared/interceptors/custom-zod.interceptor.js';
import { LoggingInterceptor } from './shared/interceptors/logging.interceptor.js';
import { RequestLoggingMiddleware } from './shared/middlewares/request-logging.middleware.ts';
import { TransformInterceptor } from './shared/interceptors/transform.interceptor.js';
import CustomZodValidationPipe from './shared/pipes/custom-zod-validation.pipe.js';
import { SharedModule } from './shared/shared.module.js';

@Module({
  imports: [
    AuthModule,
    PermissionModule,
    ProfileModule,
    PublisherModule,
    RoleModule,
    TermModule,
    SharedModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    AuthenticationGuard,
    // Guards run before controllers and decide whether the request can reach the API handler.
    {
      provide: APP_GUARD,
      useExisting: AuthenticationGuard,
    },
    // Pipes validate and transform incoming request data before it reaches controller methods.
    {
      provide: APP_PIPE,
      useClass: CustomZodValidationPipe,
    },
    // Interceptors wrap successful handler execution for logging, serialization, and response shaping.
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CustomZodSerializerInterceptor,
    },
    // Filters convert thrown errors into consistent HTTP responses.
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useClass: CatchEverythingFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*');
  }
}
