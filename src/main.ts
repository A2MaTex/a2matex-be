import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import envConfig from './shared/config.js';
import { API_PREFIX } from './shared/constants/route.constant.js';

/**
 * Explicit origins are allowed with credentials. A wildcard (or nothing) keeps
 * Nest's permissive default, which deliberately does not send credentials.
 */
function parseCorsOrigins(value: string): string[] | null {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0 || origins.includes('*')) {
    return null;
  }
  return origins;
}

/**
 * Express needs to know how many reverse proxies sit in front of the app,
 * otherwise `@Ip()` records the proxy address instead of the real client.
 */
function parseTrustProxy(value: string): boolean | number | string {
  const normalized = value.trim();
  if (normalized === '' || normalized === 'false') {
    return false;
  }
  if (normalized === 'true') {
    return true;
  }
  const hops = Number(normalized);
  return Number.isInteger(hops) && hops >= 0 ? hops : normalized;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.set('trust proxy', parseTrustProxy(envConfig.TRUST_PROXY));
  app.setGlobalPrefix(API_PREFIX);

  const corsOrigins = parseCorsOrigins(envConfig.CORS_ORIGIN);
  if (corsOrigins) {
    app.enableCors({ origin: corsOrigins, credentials: true });
  } else {
    app.enableCors();
  }

  // Lets Nest close Prisma and Redis connections when the container receives SIGTERM.
  app.enableShutdownHooks();

  const port = Number(envConfig.PORT);
  await app.listen(port, envConfig.HOST);

  Logger.log(
    `Application is running on http://${envConfig.HOST}:${port}/${API_PREFIX}`,
    'Bootstrap',
  );
}

await bootstrap();
