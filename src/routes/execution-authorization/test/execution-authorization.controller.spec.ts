import { Body, Controller, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { HttpAdapterHost, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ExecutionAuthorizationController,
  executionAuthorizationTransport,
} from '../execution-authorization.controller.ts';
import { ExecutionAuthorizationService } from '../execution-authorization.service.ts';
import { AuthenticationGuard } from '../../../shared/guards/authentication.guard.ts';
import { AccessTokenGuard } from '../../../shared/guards/access-token.guard.ts';
import { TokenService } from '../../../shared/services/token.service.ts';
import { PrismaService } from '../../../shared/services/prisma.service.ts';
import { CACHE_PROVIDER } from '../../../shared/infrastructure/cache/cache.interface.ts';
import { RequestLogContextService } from '../../../shared/infrastructure/logging/request-log-context.service.ts';
import { ContextLoggerService } from '../../../shared/infrastructure/logging/context-logger.service.ts';
import { RequestLoggingMiddleware } from '../../../shared/middlewares/request-logging.middleware.ts';
import { TransformInterceptor } from '../../../shared/interceptors/transform.interceptor.ts';
import { CustomZodSerializerInterceptor } from '../../../shared/interceptors/custom-zod.interceptor.ts';
import CustomZodValidationPipe from '../../../shared/pipes/custom-zod-validation.pipe.ts';
import { CatchEverythingFilter } from '../../../shared/filters/catch-everything.filter.ts';
import {
  ExecutionAuthorizationDeniedException,
  ExecutionAuthorizationUnavailableException,
  ExecutionAuthorizationExpiredException,
  AuthorizationRequestConflictException,
  InvalidRuntimePublicKeyException,
} from '../execution-authorization.error.ts';
import { ProductPackageUnavailableException } from '../../product/product.error.ts';
import {
  API_PREFIX,
  API_PREFIX_PATH,
  JSON_TRANSPORT_LIMIT,
} from '../../../shared/constants/system.constant.ts';
import { EXECUTION_AUTHORIZATION_BODY_MAX_BYTES } from '../../../shared/constants/execution-authorization.constant.ts';

vi.mock('../../../shared/config.ts', () => ({
  default: {
    API_PREFIX: 'test/api',
    ACCESS_TOKEN_SECRET: 'synthetic-access-token-secret',
    ACCESS_TOKEN_EXPIRES_IN: '1h',
    REFRESH_TOKEN_EXPIRES_IN: '30d',
  },
}));

@Controller('transport-probe')
class TransportProbe {
  @Post() echo(@Body() body: object) {
    return { bytes: Buffer.byteLength(JSON.stringify(body)) };
  }
}
const bundle = JSON.parse(
  readFileSync(
    new URL(
      '../../../../test/fixtures/execution-authorization/v3/protocol-vectors.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const body = bundle.request;
const endpoint = `${API_PREFIX_PATH}/execution-authorizations`;
const issueInitial = vi.fn();
const records: Array<{ severity: string; [key: string]: unknown }> = [];
let permission = true;
let app: NestExpressApplication;
let token: string;
function result(replayed = false) {
  return {
    requestId: body.requestId,
    executionId: body.executionId,
    leaseFamilyId: bundle.claims.leaseFamilyId,
    leaseId: bundle.claims.leaseId,
    sequence: 1,
    ...bundle.authorization,
    replayed,
  };
}

describe('Protected START HTTP delivery', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ExecutionAuthorizationController, TransportProbe],
      providers: [
        { provide: ExecutionAuthorizationService, useValue: { issueInitial } },
        AuthenticationGuard,
        AccessTokenGuard,
        TokenService,
        JwtService,
        RequestLogContextService,
        ContextLoggerService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findFirst: vi
                .fn()
                .mockResolvedValue({ status: 'ACTIVE', userRoles: [{ roleId: 'customer-role' }] }),
            },
            device: { findFirst: vi.fn().mockResolvedValue({ id: 'device' }) },
          },
        },
        {
          provide: CACHE_PROVIDER,
          useValue: {
            GetStateObjects: async () => ({
              'customer-role': {
                roleName: 'CUSTOMER',
                routes: permission
                  ? {
                      [`POST_${endpoint}`]: [{ permissionId: 'authorize', scope: null }],
                      [`POST_${API_PREFIX_PATH}/transport-probe`]: [
                        { permissionId: 'probe', scope: null },
                      ],
                    }
                  : {},
              },
            }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    const contexts = module.get(RequestLogContextService);
    const logger = module.get(ContextLoggerService);
    Object.defineProperty(logger, 'write', {
      value: (severity: string, fields: object) => records.push({ severity, ...fields }),
    });
    app.useLogger(logger);
    const logging = new RequestLoggingMiddleware(contexts, logger);
    app.use(logging.use.bind(logging));
    app.use(endpoint, executionAuthorizationTransport());
    app.useBodyParser('json', { limit: JSON_TRANSPORT_LIMIT });
    app.setGlobalPrefix(API_PREFIX);
    app.useGlobalGuards(module.get(AuthenticationGuard));
    app.useGlobalPipes(new CustomZodValidationPipe());
    app.useGlobalInterceptors(
      new TransformInterceptor(),
      new CustomZodSerializerInterceptor(module.get(Reflector)),
    );
    app.useGlobalFilters(new CatchEverythingFilter(app.get(HttpAdapterHost), contexts));
    token = module
      .get(TokenService)
      .signAccessToken({ userId: bundle.claims.userId, deviceId: 'synthetic-device' });
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    permission = true;
    issueInitial.mockReset().mockResolvedValue(result());
    records.length = 0;
  });

  it('returns complete 201 and exact 200 replay with one global wrapper under a custom prefix', async () => {
    for (const replayed of [false, true]) {
      issueInitial.mockResolvedValueOnce(result(replayed));
      const res = await request(app.getHttpServer())
        .post(endpoint)
        .auth(token, { type: 'bearer' })
        .send(body)
        .expect(replayed ? 200 : 201);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toEqual({
        data: {
          requestId: body.requestId,
          executionId: body.executionId,
          authorization: bundle.authorization,
        },
        statusCode: replayed ? 200 : 201,
      });
    }
    expect(issueInitial).toHaveBeenCalledWith({ userId: bundle.claims.userId, data: body });
  });
  it('keeps default authentication and route permissions before the issuer', async () => {
    await request(app.getHttpServer())
      .post(endpoint)
      .send(body)
      .expect(401)
      .expect('Cache-Control', 'no-store');
    await request(app.getHttpServer())
      .post(endpoint)
      .auth('PRIVATE-invalid-token', { type: 'bearer' })
      .send(body)
      .expect(401);
    permission = false;
    await request(app.getHttpServer())
      .post(endpoint)
      .auth(token, { type: 'bearer' })
      .send(body)
      .expect(403);
    expect(issueInitial).not.toHaveBeenCalled();
    expect(records.filter((r) => r.severity === 'ERROR')).toHaveLength(3);
    expect(JSON.stringify(records)).not.toContain('PRIVATE');
    expect(JSON.stringify(records)).not.toContain(token);
  });
  it.each([
    { ...body, userId: bundle.claims.userId },
    { ...body, packageRef: 'PRIVATE' },
    { ...body, purpose: 'REAUTHORIZE' },
    { ...body, purpose: 'RENEW' },
    { ...body, previousLeaseFamilyId: body.executionId },
    { ...body, requestId: 'invalid' },
    { ...body, runtimePublicKey: undefined },
    { ...body, runtimeKeyThumbprint: 'bad' },
  ])('rejects non-START or malformed public inputs before issuance', async (invalid) => {
    await request(app.getHttpServer())
      .post(endpoint)
      .auth(token, { type: 'bearer' })
      .send(invalid)
      .expect(422);
    expect(issueInitial).not.toHaveBeenCalled();
  });
  it.each([
    [ExecutionAuthorizationDeniedException, 403],
    [ProductPackageUnavailableException, 404],
    [AuthorizationRequestConflictException, 409],
    [ExecutionAuthorizationExpiredException, 409],
    [ExecutionAuthorizationUnavailableException, 503],
    [InvalidRuntimePublicKeyException, 422],
  ] as const)(
    'maps existing issuer exception %s without an authorization payload',
    async (error, status) => {
      issueInitial.mockRejectedValueOnce(error);
      const res = await request(app.getHttpServer())
        .post(endpoint)
        .auth(token, { type: 'bearer' })
        .send(body)
        .expect(status);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.statusCode).toBe(status);
      expect(res.body.data).toBeUndefined();
      expect(JSON.stringify(records)).not.toContain(bundle.authorization.lease);
      expect(JSON.stringify(records)).not.toContain(bundle.authorization.keyEnvelope.encryptedKey);
    },
  );
  it('sanitizes parser failures and enforces actual JSON bytes without lowering other route limits', async () => {
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Content-Type', 'application/json')
      .send('{"PRIVATE":')
      .expect(400)
      .expect('Cache-Control', 'no-store');
    const exact = JSON.stringify(body).padEnd(EXECUTION_AUTHORIZATION_BODY_MAX_BYTES, ' ');
    await request(app.getHttpServer())
      .post(endpoint)
      .auth(token, { type: 'bearer' })
      .set('Content-Type', 'application/json')
      .send(exact)
      .expect(201);
    await request(app.getHttpServer())
      .post(endpoint)
      .auth(token, { type: 'bearer' })
      .set('Content-Type', 'application/json')
      .send(exact + ' ')
      .expect(413)
      .expect('Cache-Control', 'no-store');
    const big = await request(app.getHttpServer())
      .post(`${API_PREFIX_PATH}/transport-probe`)
      .auth(token, { type: 'bearer' })
      .send({ value: 'x'.repeat(EXECUTION_AUTHORIZATION_BODY_MAX_BYTES + 1) })
      .expect(201);
    expect(big.body.data.bytes).toBeGreaterThan(EXECUTION_AUTHORIZATION_BODY_MAX_BYTES);
    expect(JSON.stringify(records)).not.toContain('PRIVATE');
  });
  it('enforces the same exact boundary on chunked HTTP bodies', async () => {
    const exact = JSON.stringify(body).padEnd(EXECUTION_AUTHORIZATION_BODY_MAX_BYTES, ' ');
    const address = await app.getUrl();
    for (const [raw, expected] of [
      [exact, 201],
      [exact + ' ', 413],
    ] as const) {
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          new URL(endpoint, address),
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode!));
          },
        );
        req.on('error', reject);
        req.write(raw.slice(0, 100));
        req.end(raw.slice(100));
      });
      expect(status).toBe(expected);
    }
  });
  it('does not expose internal metadata and uses the real response serializer', async () => {
    issueInitial.mockResolvedValueOnce({ ...result(), PRIVATE: 'PRIVATE', wrappedKey: 'PRIVATE' });
    const good = await request(app.getHttpServer())
      .post(endpoint)
      .auth(token, { type: 'bearer' })
      .send(body)
      .expect(201);
    expect(JSON.stringify(good.body)).not.toContain('PRIVATE');
    issueInitial.mockResolvedValueOnce({
      ...result(),
      keyEnvelope: { ...bundle.authorization.keyEnvelope, encryptedKey: 'PRIVATE' },
    });
    await request(app.getHttpServer())
      .post(endpoint)
      .auth(token, { type: 'bearer' })
      .send(body)
      .expect(500);
    expect(JSON.stringify(records)).not.toContain('PRIVATE');
  });
});
