import type { CookieOptions, Request, Response } from 'express';
import ms, { type StringValue } from 'ms';
import envConfig from '../config.ts';
import { AuthCookieName } from '../constants/auth.constant.ts';
import { API_PREFIX_PATH } from '../constants/system.constant.ts';

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

const BASE_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: envConfig.NODE_ENV === 'production',
};

const ACCESS_TOKEN_COOKIE_OPTIONS: CookieOptions = {
  ...BASE_COOKIE_OPTIONS,
  maxAge: getCookieMaxAge(envConfig.ACCESS_TOKEN_EXPIRES_IN),
  path: API_PREFIX_PATH,
};

const REFRESH_TOKEN_COOKIE_OPTIONS: CookieOptions = {
  ...BASE_COOKIE_OPTIONS,
  maxAge: getCookieMaxAge(envConfig.REFRESH_TOKEN_EXPIRES_IN),
  path: `${API_PREFIX_PATH}/auth`,
};

export function setAuthCookies(response: Response, tokens: AuthTokens): void {
  response.cookie(AuthCookieName.AccessToken, tokens.accessToken, ACCESS_TOKEN_COOKIE_OPTIONS);
  response.cookie(AuthCookieName.RefreshToken, tokens.refreshToken, REFRESH_TOKEN_COOKIE_OPTIONS);
}

export function clearAuthCookies(response: Response): void {
  response.clearCookie(AuthCookieName.AccessToken, clearCookieOptions(ACCESS_TOKEN_COOKIE_OPTIONS));
  response.clearCookie(
    AuthCookieName.RefreshToken,
    clearCookieOptions(REFRESH_TOKEN_COOKIE_OPTIONS),
  );
}

export function getRequestCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex < 0 || part.slice(0, separatorIndex).trim() !== name) {
      continue;
    }

    const value = part.slice(separatorIndex + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return undefined;
}

function getCookieMaxAge(value: string): number {
  const duration = ms(value as StringValue);
  if (typeof duration !== 'number') {
    throw new Error(`Invalid cookie expiration: ${value}`);
  }

  return duration;
}

function clearCookieOptions(options: CookieOptions): CookieOptions {
  const { expires: _expires, maxAge: _maxAge, ...clearOptions } = options;
  return clearOptions;
}
