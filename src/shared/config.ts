import z from 'zod';
import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { DEFAULT_STATIC_UPLOAD_MAX_SIZE_MB } from './constants/storage.constant.ts';

// A .env file is a convenience for local development. In containers the values
// arrive as real environment variables, so a missing file is not an error.
const envFilePath = path.resolve('.env');
if (fs.existsSync(envFilePath)) {
  config({ path: envFilePath });
}

const MIN_SECRET_LENGTH = 32;
const MAX_SIGNED_BIGINT = 9223372036854775807n;

const emptyToUndefined = (value: string | undefined) => (value ? value : undefined);
const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');
const optionalKafkaSaslMechanism = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.enum(['plain', 'scram-sha-256', 'scram-sha-512']).optional(),
);

const configSchema = z
  .object({
    NODE_ENV: z.string().default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.string().default('3000'),
    API_PREFIX: z.string().default('api/v1'),
    // Comma-separated browser origins. Empty or * keeps Nest's permissive default without credentials.
    CORS_ORIGIN: z.string().default('*'),
    // Number of reverse proxies in front of the app, or false when exposed directly. Caddy alone is 1.
    TRUST_PROXY: z.string().default('false'),
    POSTGRES_HOST: z.string(),
    POSTGRES_PORT: z.string(),
    POSTGRES_USER: z.string(),
    POSTGRES_PASSWORD: z.string(),
    POSTGRES_DB: z.string(),
    DATABASE_URL: z.string(),
    ACCESS_TOKEN_EXPIRES_IN: z.string().default('10m'),
    REFRESH_TOKEN_EXPIRES_IN: z.string().default('3d'),
    ACCESS_TOKEN_SECRET: z.string().min(1),
    REFRESH_TOKEN_SECRET: z.string().min(1),
    OTP_EXPIRES_IN: z.string().default('5m'),
    RESEND_API_KEY: z.string(),
    EMAIL_FROM: z.string().default('A2MaTeX <no-reply@a2matex.com>'),
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_PASSWORD: z.string().optional().transform(emptyToUndefined),
    REDIS_PREFIX: z.string().default('a2matex:'),
    KAFKA_ENABLED: booleanString,
    KAFKA_BROKERS: z.string().optional().transform(emptyToUndefined),
    KAFKA_CLIENT_ID: z.string().default('a2matex-api'),
    KAFKA_TOPIC_PREFIX: z.string().default(''),
    KAFKA_SSL: booleanString,
    KAFKA_SASL_MECHANISM: optionalKafkaSaslMechanism,
    KAFKA_SASL_USERNAME: z.string().optional().transform(emptyToUndefined),
    KAFKA_SASL_PASSWORD: z.string().optional().transform(emptyToUndefined),
    QUEUE_CONSUMER_HOST: z.string().default('0.0.0.0'),
    QUEUE_CONSUMER_PORT: z.coerce.number().int().positive().default(3002),
    OBJECT_STORAGE_ENDPOINT: z.url().optional().or(z.literal('')).transform(emptyToUndefined),
    OBJECT_STORAGE_REGION: z.string().default('auto'),
    OBJECT_STORAGE_BUCKET: z.string().optional().transform(emptyToUndefined),
    OBJECT_STORAGE_ACCESS_KEY_ID: z.string().optional().transform(emptyToUndefined),
    OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().optional().transform(emptyToUndefined),
    STATIC_UPLOAD_MAX_SIZE_MB: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_STATIC_UPLOAD_MAX_SIZE_MB),
    // Product Offer bounds. No defaults: a wrong commercial limit must stop the app,
    // not fall back to a number nobody chose.
    PRODUCT_OFFER_MAX_COUNT: z.coerce.number().int().positive(),
    PRODUCT_OFFER_MAX_DURATION_DAYS: z.coerce.number().int().positive(),
    PRODUCT_OFFER_CHANGE_MAX_COUNT: z.coerce.number().int().positive(),
    PRODUCT_OFFER_CHANGE_WINDOW_HOURS: z.coerce.number().int().positive(),
    // Decimal string: the signed BIGINT maximum does not survive a JavaScript number.
    PRODUCT_OFFER_MAX_PRICE_AMOUNT: z
      .string()
      .regex(/^\d{1,19}$/)
      .transform((value) => BigInt(value))
      .refine((value) => value <= MAX_SIGNED_BIGINT),
    // Shared secret Sepay sends back in the webhook's Authorization header.
    SEPAY_WEBHOOK_API_KEY: z.string().optional().transform(emptyToUndefined),
    // Static bank account info shown to the user when they request a top-up.
    SEPAY_BANK_ACCOUNT_NUMBER: z.string().optional().transform(emptyToUndefined),
    SEPAY_BANK_NAME: z.string().optional().transform(emptyToUndefined),
    SEPAY_BANK_ACCOUNT_HOLDER: z.string().optional().transform(emptyToUndefined),
    // Used by the reconciliation job to poll Sepay's own transaction list API.
    SEPAY_API_BASE_URL: z.string().optional().transform(emptyToUndefined),
    SEPAY_API_TOKEN: z.string().optional().transform(emptyToUndefined),
    SEPAY_RECONCILE_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
    // Cron service (src/cron). Expressions are deliberately not validated here:
    // a bad CRON_* value must stop the cron process only, never the API sharing this schema.
    CRON_PORT: z.string().default('3001'),
    CRON_SHUTDOWN_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(30),
    // Empty = derived from SEPAY_RECONCILE_INTERVAL_MINUTES; "off" disables the job.
    CRON_TOPUP_RECONCILE: z.string().optional().transform(emptyToUndefined),
    MULTIPART_SESSION_TTL: z.coerce.number().int().positive().default(3600000),
    MULTICHUNK_PART_UPLOAD_URL_TTL: z.coerce.number().int().positive().default(900),
    FILE_DOWNLOAD_URL_TTL: z.coerce.number().int().positive().default(900),
    CRON_MULTIPART_CLEAN_TIME: z.string().default('0 0 0 * * *'),
    UPLOAD_SESSION_TTL: z.coerce.number().int().positive().default(1),
    MASTER_KEY: z.string().optional().transform(emptyToUndefined),
    // Social login. Each provider is optional so an unconfigured environment still boots;
    // a half-configured one does not (see the superRefine below).
    GOOGLE_CLIENT_ID: z.string().optional().transform(emptyToUndefined),
    GOOGLE_CLIENT_SECRET: z.string().optional().transform(emptyToUndefined),
    GITHUB_CLIENT_ID: z.string().optional().transform(emptyToUndefined),
    GITHUB_CLIENT_SECRET: z.string().optional().transform(emptyToUndefined),
    // Comma-separated redirect URIs the frontend may send. Matched exactly, never by prefix.
    OAUTH_REDIRECT_URI_ALLOWLIST: z
      .string()
      .optional()
      .transform((value) =>
        value
          ? value
              .split(',')
              .map((uri) => uri.trim())
              .filter((uri) => uri.length > 0)
          : [],
      ),
    OAUTH_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  })
  .superRefine((cfg, ctx) => {
    const hasAccessKey = cfg.OBJECT_STORAGE_ACCESS_KEY_ID !== undefined;
    const hasSecretKey = cfg.OBJECT_STORAGE_SECRET_ACCESS_KEY !== undefined;
    if (hasAccessKey !== hasSecretKey) {
      ctx.addIssue({
        code: 'custom',
        path: [hasAccessKey ? 'OBJECT_STORAGE_SECRET_ACCESS_KEY' : 'OBJECT_STORAGE_ACCESS_KEY_ID'],
        message: 'Object storage access key ID and secret access key must be configured together',
      });
    }

    const hasGoogleId = cfg.GOOGLE_CLIENT_ID !== undefined;
    const hasGoogleSecret = cfg.GOOGLE_CLIENT_SECRET !== undefined;
    if (hasGoogleId !== hasGoogleSecret) {
      ctx.addIssue({
        code: 'custom',
        path: [hasGoogleId ? 'GOOGLE_CLIENT_SECRET' : 'GOOGLE_CLIENT_ID'],
        message: 'Google client ID and client secret must be configured together',
      });
    }

    const hasGithubId = cfg.GITHUB_CLIENT_ID !== undefined;
    const hasGithubSecret = cfg.GITHUB_CLIENT_SECRET !== undefined;
    if (hasGithubId !== hasGithubSecret) {
      ctx.addIssue({
        code: 'custom',
        path: [hasGithubId ? 'GITHUB_CLIENT_SECRET' : 'GITHUB_CLIENT_ID'],
        message: 'GitHub client ID and client secret must be configured together',
      });
    }

    // A configured provider with an empty allowlist boots clean and then rejects every
    // request, which is the silent-broken state the pairing rules exist to prevent.
    if ((hasGoogleId || hasGithubId) && cfg.OAUTH_REDIRECT_URI_ALLOWLIST.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['OAUTH_REDIRECT_URI_ALLOWLIST'],
        message: 'OAUTH_REDIRECT_URI_ALLOWLIST is required when a social login provider is configured',
      });
    }

    if (cfg.KAFKA_ENABLED && !cfg.KAFKA_BROKERS) {
      ctx.addIssue({
        code: 'custom',
        path: ['KAFKA_BROKERS'],
        message: 'KAFKA_BROKERS is required when Kafka is enabled',
      });
    }

    const hasKafkaUsername = cfg.KAFKA_SASL_USERNAME !== undefined;
    const hasKafkaPassword = cfg.KAFKA_SASL_PASSWORD !== undefined;
    if (hasKafkaUsername !== hasKafkaPassword) {
      ctx.addIssue({
        code: 'custom',
        path: [hasKafkaUsername ? 'KAFKA_SASL_PASSWORD' : 'KAFKA_SASL_USERNAME'],
        message: 'Kafka SASL username and password must be configured together',
      });
    }

    if (cfg.KAFKA_SASL_MECHANISM && (!hasKafkaUsername || !hasKafkaPassword)) {
      ctx.addIssue({
        code: 'custom',
        path: ['KAFKA_SASL_MECHANISM'],
        message: 'Kafka SASL credentials are required when a SASL mechanism is configured',
      });
    }

    if (!cfg.KAFKA_SASL_MECHANISM && (hasKafkaUsername || hasKafkaPassword)) {
      ctx.addIssue({
        code: 'custom',
        path: ['KAFKA_SASL_MECHANISM'],
        message: 'KAFKA_SASL_MECHANISM is required when Kafka SASL credentials are configured',
      });
    }

    // Short secrets are tolerated in development so local .env files keep working,
    // but production refuses to start with a guessable JWT key.
    if (cfg.NODE_ENV !== 'production') {
      return;
    }
    for (const key of ['ACCESS_TOKEN_SECRET', 'REFRESH_TOKEN_SECRET'] as const) {
      if (cfg[key].length < MIN_SECRET_LENGTH) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} must be at least ${MIN_SECRET_LENGTH} characters in production`,
        });
      }
    }
  });

const configServer = configSchema.safeParse(process.env);

if (!configServer.success) {
  console.error('Các giá trị khai báo trong biến môi trường không hợp lệ');
  console.error(z.prettifyError(configServer.error));
  process.exit(1);
}

const envConfig = configServer.data;

export default envConfig;
