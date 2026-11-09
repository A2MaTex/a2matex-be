import {
  BadRequestException,
  Body,
  type CallHandler,
  type CanActivate,
  Controller,
  type ExecutionContext,
  ForbiddenException,
  Get,
  type INestApplication,
  Injectable,
  type NestInterceptor,
  MiddlewareConsumer,
  Module,
  type NestModule,
  Param,
  ParseIntPipe,
  Post,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Observable } from 'rxjs';
import { throwError } from 'rxjs';
import request from 'supertest';
import { Prisma } from '../../../generated/prisma/client.ts';
import { TRACE_ID_HEADER } from '../../constants/logging.constant.ts';
import { ContextLoggerService } from '../../infrastructure/logging/context-logger.service.ts';
import { LogSanitizer } from '../../infrastructure/logging/log-sanitizer.ts';
import { RequestLogContextService } from '../../infrastructure/logging/request-log-context.service.ts';
import type { StructuredRequestLogRecord } from '../../infrastructure/logging/request-log-context.ts';
import { RequestLoggingMiddleware } from '../../middlewares/request-logging.middleware.ts';
import { ApiExceptionFilter } from '../api-exception.filter.ts';

@Injectable()
class RejectingGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    throw new UnauthorizedException('stable authentication failure');
  }
}

@Injectable()
class RejectingPermissionGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    throw new ForbiddenException('stable permission failure');
  }
}

@Injectable()
class FailingSerializationInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, _next: CallHandler): Observable<never> {
    return throwError(() => new Error('serialization password=private-serialization-value'));
  }
}

@Injectable()
class FailingRepository {
  constructor(private readonly logger: ContextLoggerService) {}

  load(): never {
    const error = new Error('repository password=private-repository-value');
    this.logger.error('failed to load repository record', error);
    throw error;
  }
}

@Injectable()
class FailingService {
  constructor(
    private readonly repository: FailingRepository,
    private readonly logger: ContextLoggerService,
  ) {}

  execute(): never {
    try {
      return this.repository.load();
    } catch (error) {
      this.logger.error('failed to execute service operation', error);
      throw error;
    }
  }
}

@Controller('phase-three')
class PhaseThreeTestController {
  constructor(
    private readonly logger: ContextLoggerService,
    private readonly service: FailingService,
  ) {}

  @Get('expected')
  expectedFailure(): never {
    throw new BadRequestException('stable client failure');
  }

  @Get('unexpected')
  unexpectedFailure(): never {
    throw new Error('database password=private-database-value is unavailable');
  }

  @Get('prisma-conflict')
  prismaConflict(): never {
    throw new Prisma.PrismaClientKnownRequestError(
      'unique constraint failed password=private-query-parameter',
      {
        code: 'P2002',
        clientVersion: 'test',
      },
    );
  }

  @Get('guard')
  @UseGuards(RejectingGuard)
  guarded(): string {
    return 'unreachable';
  }

  @Get('permission')
  @UseGuards(RejectingPermissionGuard)
  permissionDenied(): string {
    return 'unreachable';
  }

  @Get('validation/:value')
  validate(@Param('value', ParseIntPipe) value: number): number {
    return value;
  }

  @Get('serialization')
  @UseInterceptors(FailingSerializationInterceptor)
  serializationFailure(): string {
    return 'unreachable';
  }

  @Get('service-repository')
  serviceRepositoryFailure(): never {
    return this.service.execute();
  }

  @Get('swallowed')
  swallowedOperationalFailure(): string {
    this.logger.error('fallback operation failed', new Error('cache password=private-cache-value'));
    return 'fallback response';
  }

  @Get('cleanup-then-failure')
  cleanupThenFailure(): never {
    const cleanupError = new Error('cleanup noise');
    cleanupError.stack = 'Error: cleanup-only-stack';
    this.logger.error('failed to clean up stored object after upload failure', cleanupError);

    const requestError = new Error('S3 upload rejected: disk quota');
    requestError.stack = 'Error: terminal-request-stack';
    throw requestError;
  }

  @Post('request-body')
  requestBodyFailure(@Body() _requestBody: unknown): never {
    throw new Error('failed to process request');
  }

  @Get('response-body')
  responseBody(): { secret: string } {
    return { secret: 'private-response-value' };
  }
}

@Module({
  controllers: [PhaseThreeTestController],
  providers: [
    RequestLogContextService,
    LogSanitizer,
    ContextLoggerService,
    RejectingGuard,
    RejectingPermissionGuard,
    FailingSerializationInterceptor,
    FailingRepository,
    FailingService,
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
  ],
})
class PhaseThreeTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*');
  }
}

function parseRecord(stdout: ReturnType<typeof vi.spyOn>): StructuredRequestLogRecord {
  expect(stdout).toHaveBeenCalledTimes(1);
  return JSON.parse(String(stdout.mock.calls[0]?.[0])) as StructuredRequestLogRecord;
}

describe('request error logging integration', () => {
  let app: INestApplication;
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const moduleFixture = await Test.createTestingModule({
      imports: [PhaseThreeTestModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(ContextLoggerService));
    await app.init();
    stdout.mockClear();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('returns the existing safe response and one WARNING record for an expected 4xx', async () => {
    const response = await request(app.getHttpServer()).get('/phase-three/expected').expect(400);

    expect(response.body).toEqual({
      statusCode: 400,
      message: 'stable client failure',
    });
    expect(response.headers['x-trace-id']).toMatch(/^[a-f0-9]{32}$/);

    const record = parseRecord(stdout);
    expect(record).toMatchObject({
      traceId: response.headers['x-trace-id'],
      statusCode: 400,
      severity: 'WARNING',
      message: 'stable client failure',
    });
    expect(record.error).toBeUndefined();
  });

  it('returns a safe 500 and one sanitized ERROR record for an unexpected failure', async () => {
    const response = await request(app.getHttpServer()).get('/phase-three/unexpected').expect(500);

    expect(response.body).toEqual({
      statusCode: 500,
      message: 'Internal Server Error',
    });

    const record = parseRecord(stdout);
    expect(record).toMatchObject({
      statusCode: 500,
      severity: 'ERROR',
      message: 'database password=[REDACTED] is unavailable',
      error: { name: 'Error' },
    });
    expect(JSON.stringify(record)).not.toContain('private-database-value');
  });

  it('treats a mapped Prisma conflict as an operational error without leaking parameters', async () => {
    const response = await request(app.getHttpServer())
      .get('/phase-three/prisma-conflict')
      .expect(409);

    expect(response.body).toEqual({
      statusCode: 409,
      message: 'Record already exist',
    });

    const record = parseRecord(stdout);
    expect(record).toMatchObject({
      statusCode: 409,
      severity: 'ERROR',
      error: { name: 'PrismaClientKnownRequestError' },
    });
    expect(record.message).toContain('password=[REDACTED]');
    expect(JSON.stringify(record)).not.toContain('private-query-parameter');
  });

  it.each([
    ['guard', '/phase-three/guard', 401, 'WARNING'],
    ['permission guard', '/phase-three/permission', 403, 'WARNING'],
    ['validation pipe', '/phase-three/validation/not-a-number', 400, 'WARNING'],
    ['serialization interceptor', '/phase-three/serialization', 500, 'ERROR'],
  ])('finalizes a %s failure exactly once', async (_name, path, statusCode, severity) => {
    const response = await request(app.getHttpServer()).get(path).expect(statusCode);

    expect(response.headers[TRACE_ID_HEADER.toLowerCase()]).toMatch(/^[a-f0-9]{32}$/);
    expect(parseRecord(stdout)).toMatchObject({ statusCode, severity });
  });

  it('orders service and repository context before the sanitized root cause', async () => {
    await request(app.getHttpServer()).get('/phase-three/service-repository').expect(500);

    const record = parseRecord(stdout);
    expect(record.message).toBe(
      'failed to execute service operation: failed to load repository record: repository password=[REDACTED]',
    );
    expect(JSON.stringify(record)).not.toContain('private-repository-value');
  });

  it('marks a swallowed operational error as ERROR while preserving the 200 response', async () => {
    await request(app.getHttpServer()).get('/phase-three/swallowed').expect(200);

    const record = parseRecord(stdout);
    expect(record).toMatchObject({
      statusCode: 200,
      severity: 'ERROR',
      message: 'fallback operation failed: cache password=[REDACTED]',
      error: { name: 'Error' },
    });
    expect(JSON.stringify(record)).not.toContain('private-cache-value');
  });

  it('uses the terminal request failure after an earlier cleanup error', async () => {
    await request(app.getHttpServer()).get('/phase-three/cleanup-then-failure').expect(500);

    const record = parseRecord(stdout);
    expect(record).toMatchObject({
      statusCode: 500,
      severity: 'ERROR',
      message:
        'failed to clean up stored object after upload failure: S3 upload rejected: disk quota',
      error: {
        name: 'Error',
        stack: 'Error: terminal-request-stack',
      },
    });
    expect(record.error?.stack).not.toContain('cleanup-only-stack');
  });

  it('never captures request bodies or workflow documents', async () => {
    await request(app.getHttpServer())
      .post('/phase-three/request-body')
      .send({
        password: 'private-body-password',
        profile: { email: 'private-profile@example.com' },
        editorGraph: { nodes: ['private-node'] },
        runtimeIr: { instruction: 'private-runtime-instruction' },
      })
      .expect(500);

    const serialized = JSON.stringify(parseRecord(stdout));
    expect(serialized).not.toContain('private-body-password');
    expect(serialized).not.toContain('private-profile@example.com');
    expect(serialized).not.toContain('private-node');
    expect(serialized).not.toContain('private-runtime-instruction');
  });

  it('never captures response bodies', async () => {
    const response = await request(app.getHttpServer())
      .get('/phase-three/response-body')
      .expect(200);
    expect(response.body).toEqual({ secret: 'private-response-value' });

    expect(JSON.stringify(parseRecord(stdout))).not.toContain('private-response-value');
  });
});
