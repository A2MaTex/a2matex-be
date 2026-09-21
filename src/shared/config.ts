import z from 'zod';
import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';

config({
  path: '.env',
});

if (!fs.existsSync(path.resolve('.env'))) {
  console.log('Không tìm thấy file .env');
  process.exit(1);
}

const configSchema = z.object({
  NODE_ENV: z.string().default('development'),
  HOST: z.string().default('localhost'),
  PORT: z.string().default('3000'),
  API_PREFIX: z.string().default('api/v1'),
  POSTGRES_HOST: z.string(),
  POSTGRES_PORT: z.string(),
  POSTGRES_USER: z.string(),
  POSTGRES_PASSWORD: z.string(),
  POSTGRES_DB: z.string(),
  DATABASE_URL: z.string(),
  ACCESS_TOKEN_EXPIRES_IN: z.string().default('10m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('3d'),
  ACCESS_TOKEN_SECRET: z.string(),
  REFRESH_TOKEN_SECRET: z.string(),
  OTP_EXPIRES_IN: z.string().default('5m'),
  RESEND_API_KEY: z.string(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PREFIX: z.string().default('a2matex:'),
});

const configServer = configSchema.safeParse(process.env);

if (!configServer.success) {
  console.log('Các giá trị khai báo trong file .env không hợp lệ');
  console.error(configServer.error);
  process.exit(1);
}

const envConfig = configServer.data;

export default envConfig;
