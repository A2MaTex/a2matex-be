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

const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const EMAILS_URL = 'https://api.github.com/user/emails';

// GitHub documents the error body but not the status code that carries it, so the
// `error` field is the only reliable failure signal — `response.ok` is not.
const TokenResponse = z
  .object({
    access_token: z.string().min(1).optional(),
    error: z.string().optional(),
  })
  .loose();

const UserResponse = z
  .object({
    id: z.coerce.string(),
    login: z.string().min(1),
    name: z.string().nullish(),
  })
  .loose();

const EmailEntry = z
  .object({
    email: z.string(),
    primary: z.boolean(),
    verified: z.boolean(),
  })
  .loose();

@Injectable()
export class GithubOauthClient implements OAuthClient {
  private readonly logger = new Logger(GithubOauthClient.name);

  async exchangeCodeForIdentity({
    code,
    redirectUri,
  }: OAuthExchangeInput): Promise<OAuthIdentity> {
    const clientId = envConfig.GITHUB_CLIENT_ID;
    const clientSecret = envConfig.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw ProviderNotConfiguredException;
    }

    const accessToken = await this.exchangeCode({ code, redirectUri, clientId, clientSecret });
    const [profile, email] = await Promise.all([
      this.fetchUser(accessToken),
      this.fetchPrimaryEmail(accessToken),
    ]);

    return {
      provider: OAuthProvider.GITHUB,
      // `login` is renameable, `id` is not.
      providerUserId: profile.id,
      // Reported, not enforced: a returning user is identified by the link alone.
      email: email?.email ?? null,
      emailVerified: email?.verified ?? false,
      displayName: profile.name ?? profile.login,
      providerUsername: profile.login,
    };
  }

  private async exchangeCode({
    code,
    redirectUri,
    clientId,
    clientSecret,
  }: OAuthExchangeInput & { clientId: string; clientSecret: string }): Promise<string> {
    // Not retried: the code is single-use, so retrying after a lost response reports
    // "invalid code" for what was really a transport failure.
    const response = await this.request(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // Without this GitHub answers in form-urlencoded and `json()` blows up.
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    const parsed = TokenResponse.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      this.logger.error('GitHub token response had an unexpected shape');
      throw ProviderUnavailableException;
    }

    if (parsed.data.error) {
      if (parsed.data.error === 'incorrect_client_credentials') {
        this.logger.error('GitHub rejected our client credentials');
        throw ProviderNotConfiguredException;
      }
      this.logger.error(`GitHub rejected the code exchange: ${parsed.data.error}`);
      throw InvalidAuthorizationCodeException;
    }

    if (!parsed.data.access_token) {
      this.logger.error('GitHub returned neither an access token nor an error');
      throw ProviderUnavailableException;
    }

    return parsed.data.access_token;
  }

  private async fetchUser(accessToken: string) {
    const response = await this.request(USER_URL, this.authorizedInit(accessToken));
    if (!response.ok) {
      this.logger.error(`GitHub user request failed: ${response.status}`);
      throw ProviderUnavailableException;
    }

    const parsed = UserResponse.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      this.logger.error('GitHub user response had an unexpected shape');
      throw ProviderUnavailableException;
    }

    return parsed.data;
  }

  private async fetchPrimaryEmail(accessToken: string) {
    const response = await this.request(EMAILS_URL, this.authorizedInit(accessToken));

    // 403 here means the user never granted `user:email`. That is theirs to fix, so it
    // must not surface as "the system is down" — and it must not lock out a returning
    // user either, hence null rather than an exception.
    if (response.status === 403 || response.status === 404) {
      this.logger.error(`GitHub refused the email list: ${response.status}`);
      return null;
    }
    if (!response.ok) {
      this.logger.error(`GitHub email request failed: ${response.status}`);
      throw ProviderUnavailableException;
    }

    const parsed = z
      .array(EmailEntry)
      .safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      this.logger.error('GitHub email response had an unexpected shape');
      throw ProviderUnavailableException;
    }

    // The list mixes verified and unverified addresses and its order guarantees
    // nothing, so the primary+verified entry is picked explicitly. Falling back to the
    // primary-but-unverified one keeps "exists, not verified" distinguishable from
    // "no address at all" once the service applies the rule.
    return (
      parsed.data.find((entry) => entry.primary && entry.verified) ??
      parsed.data.find((entry) => entry.primary) ??
      null
    );
  }

  private authorizedInit(accessToken: string): RequestInit {
    return {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
      },
    };
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(envConfig.OAUTH_HTTP_TIMEOUT_MS),
      });
    } catch {
      this.logger.error('GitHub request failed or timed out');
      throw ProviderUnavailableException;
    }
  }
}
