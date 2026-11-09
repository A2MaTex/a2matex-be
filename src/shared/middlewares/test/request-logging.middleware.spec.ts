import {
  Controller,
  Get,
  type INestApplication,
  MiddlewareConsumer,
  Module,
  type NestModule,
  Param,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import request from 'supertest';
import { TRACE_ID_HEADER } from '../../constants/logging.constant.ts';
import { ContextLoggerService } from '../../infrastructure/logging/context-logger.service.ts';
import { LogSanitizer } from '../../infrastructure/logging/log-sanitizer.ts';
import { RequestLogContextService } from '../../infrastructure/logging/request-log-context.service.ts';
import type { StructuredRequestLogRecord } from '../../infrastructure/logging/request-log-context.ts';
import { RequestLoggingMiddleware } from '../request-logging.middleware.ts';

class FakeResponse extends EventEmitter {
  statusCode = 200;
  private readonly headers = new Map<string, number | string | readonly string[]>();

  setHeader(name: string, value: number | string | readonly string[]): this {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  getHeader(name: string): number | string | readonly string[] | undefined {
    return this.headers.get(name.toLowerCase());
  }
}

@Controller('phase-two')
class PhaseTwoTestController {
  constructor(private readonly logger: ContextLoggerService) {}

  @Get('success/:itemId')
  getSuccess(@Param('itemId') itemId: string) {
    return { itemId };
  }

  @Get('concurrent/:itemId')
  async getConcurrent(@Param('itemId') itemId: string) {
    await new Promise((resolve) => setTimeout(resolve, itemId === 'first' ? 5 : 0));
    this.logger.warn(`processed ${itemId}`);
    return { itemId };
  }
}

@Module({
  controllers: [PhaseTwoTestController],
  providers: [RequestLogContextService, LogSanitizer, ContextLoggerService],
})
class PhaseTwoTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*');
  }
}

function parseRecords(stdout: ReturnType<typeof vi.spyOn>): StructuredRequestLogRecord[] {
  return stdout.mock.calls.map(
    ([value]) => JSON.parse(String(value)) as StructuredRequestLogRecord,
  );
}

describe('RequestLoggingMiddleware lifecycle', () => {
  let contextService: RequestLogContextService;
  let middleware: RequestLoggingMiddleware;

  beforeEach(() => {
    contextService = new RequestLogContextService();
    const sanitizer = new LogSanitizer();
    const logger = new ContextLoggerService(contextService, sanitizer);
    middleware = new RequestLoggingMiddleware(contextService, logger, sanitizer);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores a client trace ID and finalizes only once across finish and close', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const rawRequest = {
      method: 'POST',
      originalUrl: '/products/123?include=media',
      baseUrl: '',
      headers: { 'x-trace-id': 'client-controlled-id' },
    };
    const requestObject = rawRequest as unknown as Request;
    const responseObject = new FakeResponse();
    responseObject.statusCode = 201;
    let activeTraceId: string | undefined;

    middleware.use(requestObject, responseObject as unknown as Response, () => {
      activeTraceId = contextService.getContext()?.traceId;
      rawRequest.route = { path: '/products/:productId' };
    });

    const responseTraceId = String(responseObject.getHeader(TRACE_ID_HEADER));
    expect(responseTraceId).toMatch(/^[a-f0-9]{32}$/);
    expect(responseTraceId).toBe(activeTraceId);
    expect(responseTraceId).not.toBe('client-controlled-id');

    responseObject.emit('finish');
    responseObject.emit('close');

    expect(stdout).toHaveBeenCalledTimes(1);
    const [record] = parseRecords(stdout);
    expect(record).toMatchObject({
      severity: 'INFO',
      traceId: responseTraceId,
      method: 'POST',
      route: '/products/:productId',
      statusCode: 201,
      message: 'request completed',
    });
    expect(Object.keys(record).sort()).toEqual(
      [
        'durationMs',
        'message',
        'method',
        'route',
        'severity',
        'statusCode',
        'timestamp',
        'traceId',
      ].sort(),
    );
  });

  it('uses close as a fallback and strips the query from an unmatched route', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const requestObject = {
      method: 'GET',
      originalUrl: '/missing/path?access_token=private',
      baseUrl: '',
      headers: {},
    } as unknown as Request;
    const responseObject = new FakeResponse();
    responseObject.statusCode = 404;

    middleware.use(requestObject, responseObject as unknown as Response, () => undefined);
    responseObject.emit('close');
    responseObject.emit('finish');

    expect(stdout).toHaveBeenCalledTimes(1);
    expect(parseRecords(stdout)[0]).toMatchObject({
      severity: 'WARNING',
      route: '/missing/path',
      statusCode: 404,
      message: 'request failed',
    });
  });

  it('does not let a stdout failure change request finalization', () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => {
      throw new Error('stdout unavailable');
    });
    const requestObject = {
      method: 'GET',
      originalUrl: '/healthy',
      baseUrl: '',
      headers: {},
    } as unknown as Request;
    const responseObject = new FakeResponse();

    middleware.use(requestObject, responseObject as unknown as Response, () => undefined);

    expect(() => responseObject.emit('finish')).not.toThrow();
    expect(responseObject.statusCode).toBe(200);
    expect(responseObject.getHeader(TRACE_ID_HEADER)).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('RequestLoggingMiddleware HTTP integration', () => {
  let app: INestApplication;
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const moduleFixture = await Test.createTestingModule({
      imports: [PhaseTwoTestModule],
    }).compile();

    app = moduleFixture.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.enableCors({ exposedHeaders: [TRACE_ID_HEADER] });
    await app.init();
    stdout.mockClear();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('returns a readable server trace ID and logs the matched route template', async () => {
    const clientTraceId = 'f'.repeat(32);
    const response = await request(app.getHttpServer())
      .get('/api/phase-two/success/123?include=details')
      .set('Origin', 'https://frontend.example')
      .set(TRACE_ID_HEADER, clientTraceId)
      .expect(200);

    const traceId = String(response.headers['x-trace-id']);
    expect(traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(traceId).not.toBe(clientTraceId);
    expect(response.headers['access-control-expose-headers']).toContain(TRACE_ID_HEADER);

    expect(stdout).toHaveBeenCalledTimes(1);
    expect(parseRecords(stdout)[0]).toMatchObject({
      traceId,
      method: 'GET',
      route: '/api/phase-two/success/:itemId',
      statusCode: 200,
      severity: 'INFO',
      message: 'request completed',
    });
  });

  it('keeps concurrent request trace IDs and buffered messages isolated', async () => {
    const [firstResponse, secondResponse] = await Promise.all([
      request(app.getHttpServer()).get('/api/phase-two/concurrent/first').expect(200),
      request(app.getHttpServer()).get('/api/phase-two/concurrent/second').expect(200),
    ]);

    const firstTraceId = String(firstResponse.headers['x-trace-id']);
    const secondTraceId = String(secondResponse.headers['x-trace-id']);
    expect(firstTraceId).not.toBe(secondTraceId);

    const records = new Map(parseRecords(stdout).map((record) => [record.traceId, record]));
    expect(records).toHaveLength(2);
    expect(records.get(firstTraceId)?.message).toBe('request completed: processed first');
    expect(records.get(secondTraceId)?.message).toBe('request completed: processed second');
  });
});
