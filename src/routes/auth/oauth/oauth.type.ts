import { OAuthProviderType } from '../../../shared/constants/auth.constant.ts';

// What both clients return once their very different responses are normalized.
export type OAuthIdentity = {
  provider: OAuthProviderType;
  /** Google's `sub`, GitHub's numeric `id` — never a renameable username. */
  providerUserId: string;
  /** Null when the provider gave us nothing usable; only the new-identity path cares. */
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  /** GitHub's `login`; Google has no equivalent. */
  providerUsername: string | null;
};

export type OAuthExchangeInput = {
  code: string;
  redirectUri: string;
};

export interface OAuthClient {
  exchangeCodeForIdentity(input: OAuthExchangeInput): Promise<OAuthIdentity>;
}
