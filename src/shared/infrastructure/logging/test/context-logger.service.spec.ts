import { ContextLoggerService } from '../context-logger.service.ts';
import { LogSanitizer } from '../log-sanitizer.ts';
import { RequestLogContextService } from '../request-log-context.service.ts';

describe('ContextLoggerService', () => {
  let requestContext: RequestLogContextService;
  let logger: ContextLoggerService;

  beforeEach(() => {
    requestContext = new RequestLogContextService();
    logger = new ContextLoggerService(requestContext, new LogSanitizer());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('buffers messages and writes nothing while a request is active', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const context = requestContext.createContext({
      traceId: 'a'.repeat(32),
      method: 'GET',
      route: '/test',
      startedAt: Date.now(),
    });
    const rootError = new Error('database unavailable');

    requestContext.run(context, () => {
      logger.log('starting work');
      logger.error('failed to query', rootError);
    });

    expect(stdout).not.toHaveBeenCalled();
    expect(context.messages).toEqual([
      { level: 'info', message: 'starting work' },
      { level: 'error', message: 'failed to query' },
    ]);
    expect(context.rootError).toBe(rootError);
  });

  it('writes one compact structured JSON line outside a request', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    logger.warn('cache password=private is unavailable');

    expect(stdout).toHaveBeenCalledTimes(1);
    const line = String(stdout.mock.calls[0]?.[0]);
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1)).not.toContain('\n');
    expect(JSON.parse(line)).toMatchObject({
      severity: 'WARNING',
      message: 'cache password=[REDACTED] is unavailable',
    });
  });

  it('includes a sanitized error name and stack outside a request', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const error = new Error('failed');
    error.stack = 'Error: failed with access_token=private-token';

    logger.error('background task failed', error);

    const line = String(stdout.mock.calls[0]?.[0]);
    const record = JSON.parse(line) as {
      error: { name: string; stack: string };
    };
    expect(record.error.name).toBe('Error');
    expect(record.error.stack).toBe('Error: failed with access_token=[REDACTED]');
  });

  it('does not throw when stdout rejects a write', () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => {
      throw new Error('stdout unavailable');
    });

    expect(() => logger.log('background message')).not.toThrow();
  });

  it('writes malicious multiline input as one valid sanitized JSON line', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    logger.error(
      'first line\nAuthorization: Basic private-basic\u0000\u007f',
      new Error('connection_string=private-connection\nsecond stack line'),
    );

    const line = String(stdout.mock.calls[0]?.[0]);
    expect(line.match(/\n/g)).toHaveLength(1);
    const record = JSON.parse(line) as { message: string; error: { stack: string } };
    expect(record.message).not.toContain('private-basic');
    expect(record.error.stack).not.toContain('private-connection');
    expect(line).not.toContain('\u0000');
    expect(line).not.toContain('\u007f');
  });
});
