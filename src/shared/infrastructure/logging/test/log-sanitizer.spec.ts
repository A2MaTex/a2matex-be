import {
  LOG_REDACTED_VALUE,
  LOG_SENSITIVE_PAYLOAD_OMITTED,
  LOG_TRUNCATION_MARKER,
  MAX_REQUEST_LOG_MESSAGE_BYTES,
  MAX_REQUEST_LOG_STACK_BYTES,
} from '../../../constants/logging.constant.ts';
import { LogSanitizer } from '../log-sanitizer.ts';

describe('LogSanitizer', () => {
  const sanitizer = new LogSanitizer();

  it('redacts credentials, bearer tokens, JWTs, and sensitive key values', () => {
    const jwt = `${'eyJabcde1234'}.${'payload12345'}.${'signature12345'}`;
    const sanitized = sanitizer.sanitizeMessage(
      `postgresql://admin:super-secret@db.internal/app Authorization: Bearer abc.def.ghi password=hunter2 api_key="key-value" token=${jwt}`,
    );

    expect(sanitized).not.toContain('admin:super-secret');
    expect(sanitized).not.toContain('abc.def.ghi');
    expect(sanitized).not.toContain('hunter2');
    expect(sanitized).not.toContain('key-value');
    expect(sanitized).not.toContain(jwt);
    expect(sanitized).toContain(LOG_REDACTED_VALUE);
  });

  it.each([
    ['authorization header', 'Authorization: Basic basic-private', 'basic-private'],
    [
      'cookies',
      'Cookie: session=private-session; refresh_token=private-refresh',
      'private-session',
    ],
    ['access token', 'access_token=private-access-token', 'private-access-token'],
    ['password', 'password=private-password', 'private-password'],
    ['OTP', 'otp: 123456', '123456'],
    ['API key', 'api-key=private-api-key', 'private-api-key'],
    [
      'connection string',
      'DATABASE_URL=postgresql://database-user:database-password@database.internal/app',
      'database-password',
    ],
    ['Sepay authentication', 'sepay_api_key=private-sepay-key', 'private-sepay-key'],
    ['storage credential', 'aws_secret_access_key=private-storage-key', 'private-storage-key'],
  ])('redacts %s', (_name, input, secret) => {
    const sanitized = sanitizer.sanitizeMessage(input);

    expect(sanitized).not.toContain(secret);
    expect(sanitized).toContain(LOG_REDACTED_VALUE);
  });

  it.each([
    ['Prisma parameters', 'failed query prisma:params ["private-prisma-value"]'],
    ['request body', 'validation failed requestBody={"password":"private-body-value"}'],
    [
      'Sepay webhook',
      'reconciliation failed sepayWebhookPayload={"content":"private-transfer-content"}',
    ],
    ['private profile', 'lookup failed profile={"email":"private-profile@example.com"}'],
    ['Project Draft', 'publish failed projectDraft={"version":3,"private":"draft-value"}'],
    [
      'Workflow Revision',
      'publish failed workflowRevision={"contentHash":"private-revision-hash"}',
    ],
    ['Editor Graph', 'publish failed editorGraph={"nodes":["private-node"]}'],
    ['Runtime IR', 'publish failed runtimeIr={"instruction":"private-runtime"}'],
  ])('omits a serialized %s payload as a whole', (_name, input) => {
    const sanitized = sanitizer.sanitizeMessage(input);

    expect(sanitized).toContain(LOG_SENSITIVE_PAYLOAD_OMITTED);
    expect(sanitized).not.toContain('private');
  });

  it('removes complete presigned URLs', () => {
    const url =
      'https://bucket.s3.amazonaws.com/private.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=private';

    expect(sanitizer.sanitizeMessage(`upload failed for ${url}`)).toBe(
      `upload failed for ${LOG_REDACTED_VALUE}`,
    );
  });

  it('enforces the message limit in UTF-8 bytes', () => {
    const sanitized = sanitizer.sanitizeMessage('🙂'.repeat(MAX_REQUEST_LOG_MESSAGE_BYTES));

    expect(Buffer.byteLength(sanitized, 'utf8')).toBeLessThanOrEqual(MAX_REQUEST_LOG_MESSAGE_BYTES);
    expect(sanitized).not.toContain('�');
    expect(sanitized.endsWith(LOG_TRUNCATION_MARKER)).toBe(true);
  });

  it('sanitizes and bounds stack traces independently', () => {
    const stack = `Error: password=secret\n${'x'.repeat(MAX_REQUEST_LOG_STACK_BYTES * 2)}`;
    const sanitized = sanitizer.sanitizeStack(stack);

    expect(sanitized).not.toContain('password=secret');
    expect(Buffer.byteLength(sanitized ?? '', 'utf8')).toBeLessThanOrEqual(
      MAX_REQUEST_LOG_STACK_BYTES,
    );
    expect(sanitized?.endsWith(LOG_TRUNCATION_MARKER)).toBe(true);
  });

  it('does not serialize arbitrary object metadata', () => {
    expect(sanitizer.sanitizeMessage({ password: 'private' })).toBe(
      '[non-string log value omitted]',
    );
  });

  it('removes unsafe control characters while preserving supported whitespace', () => {
    const sanitized = sanitizer.sanitizeMessage('first\u0000\u0007\u007f\u0085\nsecond\tvalue');

    expect(sanitized).toBe('first\nsecond\tvalue');
  });
});
