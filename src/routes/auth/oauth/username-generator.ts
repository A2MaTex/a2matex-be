import { randomBytes } from 'node:crypto';
import { OAuthProvider, OAuthProviderType } from '../../../shared/constants/auth.constant.ts';

// `User.username` is capped at 100 by its schema, which is tighter than the column's
// 255 — the tighter bound is the real one. Room is left for the collision suffix.
const MAX_USERNAME_LENGTH = 100;
const SUFFIX_RESERVE = 7;

// Deterministic: the same provider account always yields the same base.
export function buildUsernameBase({
  provider,
  displayName,
  email,
  providerUsername,
}: {
  provider: OAuthProviderType;
  displayName: string | null;
  email: string;
  providerUsername: string | null;
}): string {
  const candidates =
    provider === OAuthProvider.GITHUB
      ? [providerUsername, displayName, localPart(email)]
      : [displayName, localPart(email)];

  for (const candidate of candidates) {
    const normalized = normalize(candidate);
    if (normalized) {
      return normalized.slice(0, MAX_USERNAME_LENGTH - SUFFIX_RESERVE);
    }
  }

  return 'user';
}

/**
 * Attempt 0 takes the bare base; every retry gets a random suffix rather than a
 * counter. A counter would give each base a fixed candidate set (base, base1 … base5),
 * so once those are taken every later signup on that base fails forever — and Vietnamese
 * display names collapse onto the same base often enough for that to happen.
 */
export function withSuffix(base: string, attempt: number): string {
  if (attempt === 0) {
    return base.slice(0, MAX_USERNAME_LENGTH);
  }

  const suffix = randomBytes(3).toString('hex');
  return `${base.slice(0, MAX_USERNAME_LENGTH - suffix.length - 1)}.${suffix}`;
}

function normalize(value: string | null | undefined): string {
  if (!value) {
    return '';
  }

  return value
    .normalize('NFD')
    // Vietnamese needs both the combining marks and the standalone đ/Đ removed.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, (match) => (match === 'đ' ? 'd' : 'D'))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

function localPart(email: string): string {
  return email.split('@')[0] ?? '';
}
