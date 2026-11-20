import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import envConfig from '../../../shared/config.ts';
import { OAuthProvider } from '../../../shared/constants/auth.constant.ts';
import {
  InvalidAuthorizationCodeException,
  ProviderNotConfiguredException,
  ProviderUnavailableException,
} from '../auth.error.ts';
import type { OAuthClient, OAuthExchangeInput, OAuthIdentity } from './oauth.type.ts';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

const TokenResponse = z
  .object({
    access_token: z.string().min(1),
  })
  .loose();

// `email_verified` is a real boolean here, so the verified check is a comparison and
// never a string match. `name` is only present when the profile scope was granted.
const UserInfoResponse = z
  .object({
    sub: z.string().min(1),
    email: z.string().optional(),
    email_verified: z.boolean().optional(),
    name: z.string().optional(),
  })
  .loose();

@Injectable()
export class GoogleOauthClient implements OAuthClient {
  private readonly logger = new Logger(GoogleOauthClient.name);

  async exchangeCodeForIdentity({
    code,
    redirectUri,
  }: OAuthExchangeInput): Promise<OAuthIdentity> {
    const clientId = envConfig.GOOGLE_CLIENT_ID;
    const clientSecret = envConfig.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw ProviderNotConfiguredException;
    }

    const accessToken = await this.exchangeCode({ code, redirectUri, clientId, clientSecret });
    const profile = await this.fetchUserInfo(accessToken);

    return {
      provider: OAuthProvider.GOOGLE,
      providerUserId: profile.sub,
      // Reported, not enforced: a returning user is identified by the link alone.
      email: profile.email ?? null,
      emailVerified: profile.email_verified === true,
      displayName: profile.name ?? null,
      providerUsername: null,
    };
  }

  private async exchangeCode({
    code,
    redirectUri,
    clientId,
    clientSecret,
  }: OAuthExchangeInput & { clientId: string; clientSecret: string }): Promise<string> {
    // Deliberately not retried: the code is single-use, so a retry after a lost response
    // fails with an invalid-code error and reports the wrong cause.
    const response = await this.request(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      this.logger.error(`Google rejected the code exchange: ${response.status}`);
      throw InvalidAuthorizationCodeException;
    }

    const parsed = TokenResponse.safeParse(body);
    if (!parsed.success) {
      this.logger.error('Google token response had an unexpected shape');
      throw ProviderUnavailableException;
    }

    return parsed.data.access_token;
  }

  private async fetchUserInfo(accessToken: string) {
    const response = await this.request(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      this.logger.error(`Google userinfo request failed: ${response.status}`);
      throw ProviderUnavailableException;
    }

    const parsed = UserInfoResponse.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      this.logger.error('Google userinfo response had an unexpected shape');
      throw ProviderUnavailableException;
    }

    return parsed.data;
  }

  // Node's fetch has no default timeout, so a hung connection would pin the request
  // until the socket dies. Every call gets an explicit deadline.
  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(envConfig.OAUTH_HTTP_TIMEOUT_MS),
      });
    } catch {
      this.logger.error('Google request failed or timed out');
      throw ProviderUnavailableException;
    }
  }
}
