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
import { StaticModule } from './routes/static/static.module.ts';
import { TopUpModule } from './routes/topup/topup.module.ts';
import { LauncherReleaseModule } from './routes/launcher-release/launcher-release.module.ts';
import { NodeCatalogModule } from './routes/node-catalog/node-catalog.module.ts';
import { ProjectModule } from './routes/project/project.module.ts';
import { ProjectDraftModule } from './routes/project-draft/project-draft.module.ts';
import { SubmissionModule } from './routes/submission/submission.module.ts';
import { ProductModule } from './routes/product/product.module.ts';
import { WorkflowValidationModule } from './routes/workflow-validation/workflow-validation.module.ts';
import { ApiExceptionFilter } from './shared/filters/api-exception.filter.ts';
import { AuthenticationGuard } from './shared/guards/authentication.guard.js';
import { CustomZodSerializerInterceptor } from './shared/interceptors/custom-zod.interceptor.js';
import { RequestLoggingMiddleware } from './shared/middlewares/request-logging.middleware.ts';
import { TransformInterceptor } from './shared/interceptors/transform.interceptor.js';
import CustomZodValidationPipe from './shared/pipes/custom-zod-validation.pipe.js';
import { SharedModule } from './shared/shared.module.js';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    AuthModule,
    PermissionModule,
    ProfileModule,
    PublisherModule,
    RoleModule,
    TermModule,
    StaticModule,
    TopUpModule,
    LauncherReleaseModule,
    NodeCatalogModule,
    ProjectModule,
    ProjectDraftModule,
    ProductModule,
    SubmissionModule,
    WorkflowValidationModule,
    SharedModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
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
    // Interceptors wrap handler execution for serialization and response shaping.
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CustomZodSerializerInterceptor,
    },
    // One first-match exception boundary preserves response normalization and
    // records failures without competing filter output.
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*');
  }
}
