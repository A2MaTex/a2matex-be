import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import envConfig from '../../shared/config.ts';

// Sepay sends the configured API Key with this exact prefix — see
// https://docs.sepay.vn/tich-hop-webhooks.html ("Authorization: Apikey <API_KEY_CUA_BAN>").
const SEPAY_AUTH_HEADER_PREFIX = 'Apikey ';

@Injectable()
/**
 * Verifies that an incoming Sepay webhook call carries the shared-secret API
 * key configured in the Sepay dashboard, before the payload reaches business
 * logic (FR-010). Request without a matching key is rejected and logged.
 */
export class SepayWebhookGuard implements CanActivate {
  private readonly logger = new Logger(SepayWebhookGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authorizationHeader = request.headers.authorization;
    const providedKey = authorizationHeader?.startsWith(SEPAY_AUTH_HEADER_PREFIX)
      ? authorizationHeader.slice(SEPAY_AUTH_HEADER_PREFIX.length)
      : undefined;

    if (!providedKey || !this.isValidKey(providedKey)) {
      this.logger.warn(`Rejected Sepay webhook call from ${request.ip} — invalid API key`);
      throw new UnauthorizedException();
    }

    return true;
  }

  private isValidKey(providedKey: string): boolean {
    const expectedKey = envConfig.SEPAY_WEBHOOK_API_KEY ?? '';
    const provided = Buffer.from(providedKey);
    const expected = Buffer.from(expectedKey);

    if (provided.length !== expected.length) {
      return false;
    }

    return timingSafeEqual(provided, expected);
  }
}
