import {
  LOG_MESSAGES_TRUNCATED_MARKER,
  MAX_REQUEST_LOG_MESSAGES,
} from '../../../constants/logging.constant.ts';
import { LogSanitizer } from '../log-sanitizer.ts';
import { RequestLogContextService } from '../request-log-context.service.ts';
import { buildRequestLogMessage } from '../request-log-formatter.ts';

describe('buildRequestLogMessage', () => {
  const sanitizer = new LogSanitizer();

  function setup() {
    const service = new RequestLogContextService();
    const context = service.createContext({
      traceId: 'a'.repeat(32),
      method: 'POST',
      route: '/products',
      startedAt: Date.now(),
    });
    return { service, context };
  }

  it('uses the default message for a quiet successful request', () => {
    const { context } = setup();

    expect(buildRequestLogMessage(context, sanitizer)).toBe('request completed');
  });

  it('appends deliberately recorded success messages in call order', () => {
    const { service, context } = setup();
    service.run(context, () => {
      service.addMessage('info', 'used fallback cache');
      service.addMessage('warn', 'response is stale');
    });

    expect(buildRequestLogMessage(context, sanitizer)).toBe(
      'request completed: used fallback cache: response is stale',
    );
  });

  it('orders failure context from the outer operation to the root cause', () => {
    const { service, context } = setup();
    service.run(context, () => {
      service.addMessage('warn', 'fallback lookup failed');
      service.addMessage(
        'error',
        'failed to check existing product name',
        new Error('connection credentials is invalid'),
      );
      service.addMessage('error', 'failed to create product');
    });

    expect(buildRequestLogMessage(context, sanitizer)).toBe(
      'failed to create product: failed to check existing product name: fallback lookup failed: connection credentials is invalid',
    );
  });

  it('does not append a root cause already present in a diagnostic message', () => {
    const { service, context } = setup();
    service.run(context, () => {
      service.addMessage(
        'error',
        'failed to load product: connection refused',
        new Error('connection refused'),
      );
    });

    expect(buildRequestLogMessage(context, sanitizer)).toBe(
      'failed to load product: connection refused',
    );
  });

  it('keeps the sanitized root cause last when messages were capped', () => {
    const { service, context } = setup();
    service.run(context, () => {
      service.addMessage('error', 'inner failure', new Error('password=private-value'));
      context.messagesTruncated = true;
    });

    const message = buildRequestLogMessage(context, sanitizer);
    expect(message).toContain(LOG_MESSAGES_TRUNCATED_MARKER);
    expect(message.endsWith('password=[REDACTED]')).toBe(true);
  });

  it('adds a visible marker when the real request message cap is exceeded', () => {
    const { service, context } = setup();
    service.run(context, () => {
      for (let index = 0; index <= MAX_REQUEST_LOG_MESSAGES; index += 1) {
        service.addMessage('info', `message ${index}`);
      }
    });

    const message = buildRequestLogMessage(context, sanitizer);
    expect(context.messages).toHaveLength(MAX_REQUEST_LOG_MESSAGES);
    expect(message).toContain(LOG_MESSAGES_TRUNCATED_MARKER);
    expect(message).not.toContain(`message ${MAX_REQUEST_LOG_MESSAGES}`);
  });
});
