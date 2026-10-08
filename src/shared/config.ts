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

const emptyToUndefined = (value: string | undefined) => (value ? value : undefined);

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
    EMAIL_FROM: z.string().default('A2MaTeX <onboarding@resend.dev>'),
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_PASSWORD: z.string().optional().transform(emptyToUndefined),
    REDIS_PREFIX: z.string().default('a2matex:'),
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
    // Shared secret Sepay sends back in the webhook's Authorization header.
    SEPAY_WEBHOOK_API_KEY: z.string(),
    // Static bank account info shown to the user when they request a top-up.
    SEPAY_BANK_ACCOUNT_NUMBER: z.string(),
    SEPAY_BANK_NAME: z.string(),
    SEPAY_BANK_ACCOUNT_HOLDER: z.string(),
    // Used by the reconciliation job to poll Sepay's own transaction list API.
    SEPAY_API_BASE_URL: z.string(),
    SEPAY_API_TOKEN: z.string(),
    SEPAY_RECONCILE_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
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
