import { MAX_REQUEST_LOG_MESSAGES } from '../../../constants/logging.constant.ts';
import { ContextLoggerService } from '../context-logger.service.ts';
import { LogSanitizer } from '../log-sanitizer.ts';
import { RequestLogContextService } from '../request-log-context.service.ts';

function createContext(service: RequestLogContextService, traceId: string) {
  return service.createContext({
    traceId,
    method: 'GET',
    route: '/test',
    startedAt: Date.now(),
  });
}

describe('RequestLogContextService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves context through nested asynchronous calls', async () => {
    const service = new RequestLogContextService();
    const context = createContext(service, 'a'.repeat(32));

    await service.run(context, async () => {
      await Promise.resolve();
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(service.getContext()).toBe(context);
          service.addMessage('info', 'nested work');
          resolve();
        }, 0);
      });
    });

    expect(context.messages).toEqual([{ level: 'info', message: 'nested work' }]);
    expect(service.getContext()).toBeUndefined();
  });

  it('isolates concurrent request contexts', async () => {
    const service = new RequestLogContextService();
    const first = createContext(service, 'a'.repeat(32));
    const second = createContext(service, 'b'.repeat(32));

    await Promise.all([
      service.run(first, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        service.addMessage('error', 'first failure', new Error('first root'));
        expect(service.getContext()?.traceId).toBe(first.traceId);
      }),
      service.run(second, async () => {
        service.addMessage('warn', 'second warning');
        await Promise.resolve();
        expect(service.getContext()?.traceId).toBe(second.traceId);
      }),
    ]);

    expect(first.messages.map(({ message }) => message)).toEqual(['first failure']);
    expect(first.rootError?.message).toBe('first root');
    expect(second.messages.map(({ message }) => message)).toEqual(['second warning']);
    expect(second.rootError).toBeUndefined();
  });

  it('caps messages and ignores every mutation after finalization', () => {
    const service = new RequestLogContextService();
    const context = createContext(service, 'c'.repeat(32));

    service.run(context, () => {
      for (let index = 0; index <= MAX_REQUEST_LOG_MESSAGES; index += 1) {
        service.addMessage('info', `message ${index}`);
      }
      expect(service.finalize()).toBe(true);
      expect(service.finalize()).toBe(false);
      service.addMessage('error', 'late message', new Error('late root'));
      service.setUserId('late-user');
      service.recordFailure(500, new Error('late failure'));
    });

    expect(context.messages).toHaveLength(MAX_REQUEST_LOG_MESSAGES);
    expect(context.messagesTruncated).toBe(true);
    expect(context.userId).toBeUndefined();
    expect(context.failureStatusCode).toBeUndefined();
    expect(context.rootError).toBeUndefined();
  });

  it('retains the first concrete diagnostic error added by messages', () => {
    const service = new RequestLogContextService();
    const context = createContext(service, 'd'.repeat(32));
    const deepestError = new Error('deepest');

    service.run(context, () => {
      service.addMessage('error', 'repository failed', deepestError);
      service.addMessage('error', 'service failed', new Error('outer'));
    });

    expect(context.rootError).toBe(deepestError);
  });

  it('prioritizes the terminal request failure over an earlier diagnostic error', () => {
    const service = new RequestLogContextService();
    const context = createContext(service, 'e'.repeat(32));
    const cleanupError = new Error('cleanup noise');
    const requestError = new Error('S3 upload rejected: disk quota');

    service.run(context, () => {
      service.addMessage('error', 'failed to clean up stored object', cleanupError);
      service.recordFailure(500, requestError);
    });

    expect(context.rootError).toBe(requestError);
    expect(context.failureStatusCode).toBe(500);
    expect(context.messages).toEqual([
      { level: 'error', message: 'failed to clean up stored object' },
    ]);
  });

  it('isolates trace, user, messages, and errors under concurrent stress', async () => {
    const service = new RequestLogContextService();
    const contexts = Array.from({ length: 50 }, (_, index) =>
      createContext(service, index.toString(16).padStart(32, '0')),
    );

    await Promise.all(
      contexts.map((context, index) =>
        service.run(context, async () => {
          await new Promise((resolve) => setTimeout(resolve, index % 4));
          service.setUserId(`user-${index}`);
          await Promise.resolve();
          service.addMessage('error', `message-${index}`, new Error(`root-${index}`));
        }),
      ),
    );

    contexts.forEach((context, index) => {
      expect(context.userId).toBe(`user-${index}`);
      expect(context.messages).toEqual([{ level: 'error', message: `message-${index}` }]);
      expect(context.rootError?.message).toBe(`root-${index}`);
    });
  });

  it('prevents detached work from appending or writing after finalization', async () => {
    const service = new RequestLogContextService();
    const logger = new ContextLoggerService(service, new LogSanitizer());
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const context = createContext(service, 'e'.repeat(32));
    let detachedWork: Promise<void> | undefined;

    service.run(context, () => {
      detachedWork = new Promise<void>((resolve) => {
        setTimeout(() => {
          logger.error('late detached failure', new Error('late root'));
          resolve();
        }, 0);
      });
      expect(service.finalize()).toBe(true);
    });

    await detachedWork;
    expect(context.messages).toEqual([]);
    expect(context.rootError).toBeUndefined();
    expect(stdout).not.toHaveBeenCalled();
  });
});
