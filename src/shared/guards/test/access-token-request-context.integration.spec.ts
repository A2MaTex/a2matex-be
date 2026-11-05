import {
  Controller,
  Get,
  type INestApplication,
  MiddlewareConsumer,
  Module,
  type NestModule,
  UseGuards,
} from '@nestjs/common';
import { APP_FILTER, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { UserStatus } from '../../constants/auth.constant.ts';
import { SkipPermissionCheck } from '../../decorators/auth.decorator.ts';
import { ApiExceptionFilter } from '../../filters/api-exception.filter.ts';
import { CACHE_PROVIDER } from '../../infrastructure/cache/cache.interface.ts';
import { ContextLoggerService } from '../../infrastructure/logging/context-logger.service.ts';
import { LogSanitizer } from '../../infrastructure/logging/log-sanitizer.ts';
import { RequestLogContextService } from '../../infrastructure/logging/request-log-context.service.ts';
import type { StructuredRequestLogRecord } from '../../infrastructure/logging/request-log-context.ts';
import { RequestLoggingMiddleware } from '../../middlewares/request-logging.middleware.ts';
import { PrismaService } from '../../services/prisma.service.ts';
import { TokenService } from '../../services/token.service.ts';
import { AccessTokenGuard } from '../access-token.guard.ts';

const AUTHENTICATED_USER_ID = 'usr_authenticated';
const AUTHENTICATED_DEVICE_ID = 'dev_private';

const verifyAccessToken = vi.fn(async (token: string) => {
  if (token !== 'valid-access-token') {
    throw new Error('invalid token');
  }
  return {
    userId: AUTHENTICATED_USER_ID,
    deviceId: AUTHENTICATED_DEVICE_ID,
    iat: 1,
    exp: 2,
  };
});

const prismaMock = {
  user: {
    findFirst: vi.fn(async () => ({
      status: UserStatus.ACTIVE,
      userRoles: [{ roleId: 'role_private' }],
    })),
  },
  device: {
    findFirst: vi.fn(async () => ({ id: AUTHENTICATED_DEVICE_ID })),
  },
  role: {
    findMany: vi.fn(async () => []),
  },
};

@Controller('phase-four-auth')
class AuthContextTestController {
  @Get('public')
  publicRoute(): string {
    return 'public';
  }

  @Get('protected')
  @UseGuards(AccessTokenGuard)
  @SkipPermissionCheck()
  protectedRoute(): string {
    return 'protected';
  }
}

@Module({
  controllers: [AuthContextTestController],
  providers: [
    Reflector,
    RequestLogContextService,
    LogSanitizer,
    ContextLoggerService,
    AccessTokenGuard,
    { provide: TokenService, useValue: { verifyAccessToken } },
    { provide: PrismaService, useValue: prismaMock },
    {
      provide: CACHE_PROVIDER,
      useValue: {
        GetStateObjects: vi.fn(async () => ({})),
        SetStateObject: vi.fn(async () => undefined),
      },
    },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
class AuthContextTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*');
  }
}

function parseRecord(stdout: ReturnType<typeof vi.spyOn>): StructuredRequestLogRecord {
  expect(stdout).toHaveBeenCalledTimes(1);
  return JSON.parse(String(stdout.mock.calls[0]?.[0])) as StructuredRequestLogRecord;
}

describe('AccessTokenGuard request logging context', () => {
  let app: INestApplication;
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const moduleFixture = await Test.createTestingModule({
      imports: [AuthContextTestModule],
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

  it('omits userId for a public request', async () => {
    await request(app.getHttpServer()).get('/phase-four-auth/public').expect(200);

    expect(parseRecord(stdout).userId).toBeUndefined();
  });

  it('adds only userId after successful access-token decoding', async () => {
    await request(app.getHttpServer())
      .get('/phase-four-auth/protected')
      .set('Authorization', 'Bearer valid-access-token')
      .expect(200);

    const record = parseRecord(stdout);
    expect(record.userId).toBe(AUTHENTICATED_USER_ID);
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('valid-access-token');
    expect(serialized).not.toContain(AUTHENTICATED_DEVICE_ID);
    expect(serialized).not.toContain('role_private');
    expect(serialized).not.toContain('authorization');
  });

  it('omits userId when access-token decoding is rejected', async () => {
    await request(app.getHttpServer())
      .get('/phase-four-auth/protected')
      .set('Authorization', 'Bearer rejected-access-token')
      .expect(401);

    const record = parseRecord(stdout);
    expect(record.userId).toBeUndefined();
    expect(JSON.stringify(record)).not.toContain('rejected-access-token');
  });
});
