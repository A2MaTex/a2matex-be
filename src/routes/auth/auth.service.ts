import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { addMilliseconds } from 'date-fns';
import { AuthRepository } from './auth.repo.js';
import { SharedUserRepository } from '../../shared/repositories/shared-user.repo.js';
import { HashingService } from '../../shared/services/hashing.service.js';
import { TokenService } from '../../shared/services/token.service.js';
import ms, { StringValue } from 'ms';
import envConfig from '../../shared/config.js';
import {
  EmailSubject,
  OAuthProvider,
  OAuthProviderType,
  TypeOfVerificationCode,
  TypeOfVerificationCodeType,
  UserStatus,
} from '../../shared/constants/auth.constant.js';
import { EmailService } from '../../shared/services/email.service.js';
import { AccessTokenPayloadCreate } from '../../shared/types/jwt.type.js';
import { UserType } from '../../entities/user.model.ts';
import {
  EmailAlreadyExistsException,
  InvalidCredentialsException,
  EmailNotFoundException,
  AccountBlockedException,
  FailedToSendOTPException,
  InvalidOTPException,
  OTPExpiredException,
  accountUsesSocialLoginException,
  InvalidProviderEmailException,
  ProviderAlreadyLinkedException,
  ProviderEmailUnavailableException,
  NoActiveRoleException,
  ProviderEmailNotVerifiedException,
  RedirectUriNotAllowedException,
  RefreshTokenAlreadyUsedException,
  UnauthorizedAccessException,
  UsernameAlreadyExistsException,
  UsernameGenerationExhaustedException,
} from './auth.error.js';
import { SharedRoleRepository } from '../../shared/repositories/shared-role.repo.js';
import { SUCCESS_RESPONSE } from '../../shared/models/response.model.ts';
import {
  ForgotPasswordInputType,
  LoginInputType,
  RegisterInputType,
  SendOTPInputType,
  SocialLoginInputType,
} from './auth.model.ts';
import { GithubOauthClient } from './oauth/github-oauth.client.ts';
import { GoogleOauthClient } from './oauth/google-oauth.client.ts';
import type { OAuthIdentity } from './oauth/oauth.type.ts';
import { buildUsernameBase, withSuffix } from './oauth/username-generator.ts';
import { z } from 'zod';
import { isNotFoundPrismaError, isUniqueConstraintPrismaError } from '../../shared/utils/prisma.ts';
import { generateOTP } from '../../shared/utils/utils.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';

type UniqueViolationMeta = {
  target?: unknown;
  driverAdapterError?: { cause?: { constraint?: { index?: string } } };
};

// Bounded so a pathological run of clashes fails loudly instead of looping.
const MAX_USERNAME_ATTEMPTS = 5;
// Profile.fullName is VarChar(255) and carries no schema-level max, so the cut has to
// happen here. A long display name must not cost someone their sign-in.
const MAX_FULL_NAME_LENGTH = 255;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(HashingService) private readonly hashingService: HashingService,
    @Inject(SharedRoleRepository) private readonly sharedRoleRepository: SharedRoleRepository,
    @Inject(AuthRepository) private readonly authRepository: AuthRepository,
    @Inject(SharedUserRepository) private readonly sharedUserRepository: SharedUserRepository,
    @Inject(EmailService) private readonly emailService: EmailService,
    @Inject(TokenService) private readonly tokenService: TokenService,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
    @Inject(GoogleOauthClient) private readonly googleOauthClient: GoogleOauthClient,
    @Inject(GithubOauthClient) private readonly githubOauthClient: GithubOauthClient,
  ) {}

  async validateVerificationCode({
    email,
    type,
    code,
  }: {
    email: string;
    type: TypeOfVerificationCodeType;
    code: string;
  }) {
    const vevificationCode = await this.authRepository.findUniqueVerificationCode({
      email_type: {
        email,
        type,
      },
    });
    if (!vevificationCode || vevificationCode.code !== code) {
      throw InvalidOTPException;
    }
    if (new Date(vevificationCode.expiresAt) < new Date()) {
      throw OTPExpiredException;
    }
    return vevificationCode;
  }

  async register(body: RegisterInputType & { userAgent: string; ip: string }) {
    try {
      await this.validateRegisterAccountIsUnique({
        email: body.email,
        username: body.username,
      });
      await this.validateVerificationCode({
        email: body.email,
        type: TypeOfVerificationCode.REGISTER,
        code: body.code,
      });
      const [customerRoleId, hashedPassword] = await Promise.all([
        this.sharedRoleRepository.getCustomerRoleId(),
        this.hashingService.hash(body.password),
      ]);
      return await this.registerWithSession({
        email: body.email,
        username: body.username,
        password: hashedPassword,
        fullName: body.fullName,
        roleId: customerRoleId,
        userAgent: body.userAgent,
        ip: body.ip,
      });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (isUniqueConstraintPrismaError(error)) {
        try {
          await this.validateRegisterAccountIsUnique({
            email: body.email,
            username: body.username,
          });
        } catch (recheckError) {
          if (!(recheckError instanceof HttpException)) {
            this.logger.error('failed to check for an existing registration', recheckError);
          }
          throw recheckError;
        }
        throw EmailAlreadyExistsException;
      }
      this.logger.error('failed to register', error);
      throw error;
    }
  }

  @Transactional()
  private async registerWithSession({
    email,
    username,
    password,
    fullName,
    roleId,
    userAgent,
    ip,
  }: Pick<RegisterInputType, 'email' | 'username' | 'fullName'> & {
    password: string;
    roleId: string;
    userAgent: string;
    ip: string;
  }) {
    const user = await this.authRepository.createUserIncludeRole({
      email,
      username,
      password,
      fullName,
      roleId,
    });

    const device = await this.authRepository.createDevice({
      userId: user.id,
      userAgent,
      ip,
      lastActive: new Date(),
    });

    await this.authRepository.deleteVerificationCode({
      email_type: {
        email,
        type: TypeOfVerificationCode.REGISTER,
      },
    });

    return this.generateTokens({
      userId: user.id,
      deviceId: device.id,
    });
  }

  async sendOTP(body: SendOTPInputType) {
    try {
      const user = await this.authRepository.findUserByEmailInsensitive(body.email);
      // Both OTP types stop here for a provider-only account, before a code is created
      // and before any mail goes out.
      if (user && user.password === null) {
        throw accountUsesSocialLoginException();
      }
      if (body.type === TypeOfVerificationCode.REGISTER && user) {
        throw EmailAlreadyExistsException;
      }
      if (body.type === TypeOfVerificationCode.FORGOT_PASSWORD && !user) {
        throw EmailNotFoundException;
      }

      const code = generateOTP();
      await this.authRepository.createVerificationCode({
        email: body.email,
        code,
        type: body.type,
        expiresAt: addMilliseconds(new Date(), ms(envConfig.OTP_EXPIRES_IN as StringValue)),
      });

      let subject: string;
      switch (body.type) {
        case TypeOfVerificationCode.REGISTER:
          subject = EmailSubject.REGISTER;
          break;
        case TypeOfVerificationCode.FORGOT_PASSWORD:
          subject = EmailSubject.FORGOT_PASSWORD;
          break;
        default:
          throw new Error('Invalid verification code type');
      }

      const { error } = await this.emailService.sendOTP({
        email: body.email,
        code,
        subject,
      });
      if (error) {
        this.logger.error('email provider rejected the verification email');
        throw FailedToSendOTPException;
      }
      return SUCCESS_RESPONSE;
    } catch (error) {
      if (!(error instanceof HttpException)) {
        this.logger.error('failed to send verification code', error);
      }
      throw error;
    }
  }

  async login(body: LoginInputType & { userAgent: string; ip: string }) {
    try {
      const user = await this.authRepository.findUniqueUserWithActiveRole({
        account: body.account,
      });
      if (!user) {
        this.logger.error('email or username not found');
        throw InvalidCredentialsException;
      }
      if (user.status === UserStatus.BANNED) {
        this.logger.error('account blocked');
        throw AccountBlockedException;
      }

      // An account created through a provider has no password to compare against, and
      // bcrypt would throw on a null hash. Say what is actually true instead.
      if (user.password === null) {
        throw accountUsesSocialLoginException();
      }

      const isPasswordMatch = await this.hashingService.compare(body.password, user.password);
      if (!isPasswordMatch) {
        this.logger.error('invalid password');
        throw InvalidCredentialsException;
      }

      return await this.loginWithSession({
        userId: user.id,
        userAgent: body.userAgent,
        ip: body.ip,
      });
    } catch (error) {
      if (!(error instanceof HttpException)) {
        this.logger.error('failed to log in', error);
      }
      throw error;
    }
  }

  @Transactional()
  private async loginWithSession({
    userId,
    userAgent,
    ip,
  }: Omit<AccessTokenPayloadCreate, 'deviceId'> & { userAgent: string; ip: string }) {
    const device = await this.authRepository.createDevice({
      userId,
      userAgent,
      ip,
      lastActive: new Date(),
    });

    return this.generateTokens({
      userId,
      deviceId: device.id,
    });
  }

  async socialLogin(
    provider: OAuthProviderType,
    body: SocialLoginInputType & { userAgent: string; ip: string },
  ) {
    try {
      this.assertRedirectUriAllowed(body.redirectUri);

      // Everything that talks to the provider happens here, outside any transaction:
      // a slow provider must never hold a database connection.
      const client =
        provider === OAuthProvider.GOOGLE ? this.googleOauthClient : this.githubOauthClient;
      const identity = await client.exchangeCodeForIdentity({
        code: body.code,
        redirectUri: body.redirectUri,
      });

      // A matching link identifies a returning user on its own — their email is not
      // consulted at all, so neither changing it at the provider nor losing access to
      // it (revoked email scope, unverified primary address) can lock them out.
      const existing = await this.authRepository.findIdentity(provider, identity.providerUserId);
      if (existing) {
        await this.assertUserCanSignIn(existing.user);
        return await this.loginWithSession({
          userId: existing.user.id,
          userAgent: body.userAgent,
          ip: body.ip,
        });
      }

      // Everything below creates or claims an account, so now the email has to hold up.
      if (!identity.email) {
        throw ProviderEmailUnavailableException;
      }
      const email = this.parseProviderEmail(identity.email);
      if (!identity.emailVerified) {
        throw ProviderEmailNotVerifiedException;
      }

      return await this.resolveNewIdentity({ identity, email, body });
    } catch (error) {
      if (!(error instanceof HttpException)) {
        this.logger.error(`failed to sign in with ${provider}`, error);
      }
      throw error;
    }
  }

  private async resolveNewIdentity({
    identity,
    email,
    body,
  }: {
    identity: OAuthIdentity;
    email: string;
    body: SocialLoginInputType & { userAgent: string; ip: string };
  }) {
    // Existence check deliberately ignores roles: an account whose roles were all
    // deactivated still owns its email, and treating it as absent would send us down
    // the create branch and into the unique index on lower(email).
    const user = await this.authRepository.findUserByEmailInsensitive(email);
    if (user) {
      await this.assertUserCanSignIn(user);
      return await this.linkIdentityWithSession({
        identity,
        email,
        userId: user.id,
        userAgent: body.userAgent,
        ip: body.ip,
      });
    }

    return await this.createAccountWithIdentity({ identity, email, body });
  }

  @Transactional()
  private async linkIdentityWithSession({
    identity,
    email,
    userId,
    userAgent,
    ip,
  }: {
    identity: OAuthIdentity;
    email: string;
    userId: string;
    userAgent: string;
    ip: string;
  }) {
    // Only the link row is written. Name, avatar and both email fields belong to the
    // user, and signing in with Google is not consent to have them overwritten.
    try {
      await this.authRepository.createIdentity({
        provider: identity.provider,
        providerUserId: identity.providerUserId,
        userId,
        email,
      });
    } catch (error) {
      // The account already holds a link for this provider — a second provider account
      // on the same address, or two first-time logins racing. Without this the raw
      // P2002 escapes as a bare 409 that says nothing.
      if (isUniqueConstraintPrismaError(error)) {
        throw ProviderAlreadyLinkedException;
      }
      throw error;
    }

    return this.loginWithSession({ userId, userAgent, ip });
  }

  private async createAccountWithIdentity({
    identity,
    email,
    body,
  }: {
    identity: OAuthIdentity;
    email: string;
    body: SocialLoginInputType & { userAgent: string; ip: string };
  }) {
    const customerRoleId = await this.sharedRoleRepository.getCustomerRoleId();
    const usernameBase = buildUsernameBase({
      provider: identity.provider,
      displayName: identity.displayName,
      providerUsername: identity.providerUsername,
      email,
    });
    // The profile needs a name and the provider may not supply one.
    const fullName = this.truncateFullName(identity.displayName ?? usernameBase);

    for (let attempt = 0; attempt <= MAX_USERNAME_ATTEMPTS; attempt += 1) {
      try {
        return await this.createAccountWithSession({
          identity,
          email,
          username: withSuffix(usernameBase, attempt),
          fullName,
          roleId: customerRoleId,
          userAgent: body.userAgent,
          ip: body.ip,
        });
      } catch (error) {
        if (!isUniqueConstraintPrismaError(error)) {
          throw error;
        }

        // A username clash is retried with a new suffix. Anything else means another
        // request won the race for this email, so resolve against that account instead.
        if (!this.isUsernameConflict(error)) {
          const winner = await this.authRepository.findUserByEmailInsensitive(email);
          if (!winner) {
            throw error;
          }
          await this.assertUserCanSignIn(winner);
          return await this.linkIdentityWithSession({
            identity,
            email,
            userId: winner.id,
            userAgent: body.userAgent,
            ip: body.ip,
          });
        }
      }
    }

    throw UsernameGenerationExhaustedException;
  }

  // Each attempt gets its own transaction: a failed statement aborts the surrounding
  // one, so retrying inside it would only collect more errors.
  @Transactional()
  private async createAccountWithSession({
    identity,
    email,
    username,
    fullName,
    roleId,
    userAgent,
    ip,
  }: {
    identity: OAuthIdentity;
    email: string;
    username: string;
    fullName: string;
    roleId: string;
    userAgent: string;
    ip: string;
  }) {
    const user = await this.authRepository.createUserFromProvider({
      email,
      username,
      fullName,
      roleId,
    });

    await this.authRepository.createIdentity({
      provider: identity.provider,
      providerUserId: identity.providerUserId,
      userId: user.id,
      email,
    });

    return this.loginWithSession({ userId: user.id, userAgent, ip });
  }

  private async assertUserCanSignIn(user: Pick<UserType, 'id' | 'status'>) {
    if (user.status === UserStatus.BANNED) {
      throw AccountBlockedException;
    }

    // Deactivating every role is how an account is locked out on the password door,
    // so the provider door has to honour it too.
    if (!(await this.authRepository.hasActiveRole(user.id))) {
      throw NoActiveRoleException;
    }
  }

  private assertRedirectUriAllowed(redirectUri: string) {
    // Exact match only: a prefix match would accept any path under the same origin.
    if (!envConfig.OAUTH_REDIRECT_URI_ALLOWLIST.includes(redirectUri)) {
      throw RedirectUriNotAllowedException;
    }
  }

  private parseProviderEmail(email: string): string {
    const parsed = z.email().safeParse(email);
    if (!parsed.success) {
      throw InvalidProviderEmailException;
    }

    return parsed.data;
  }

  private truncateFullName(fullName: string): string {
    return fullName.slice(0, MAX_FULL_NAME_LENGTH);
  }

  /**
   * The driver adapter reports the violated index under `driverAdapterError`, not under
   * `meta.target` — that one is undefined here, and reading it made every clash look
   * like an email race. `meta.target` is kept as a fallback for other Prisma setups.
   */
  private isUsernameConflict(error: unknown): boolean {
    const meta = (error as { meta?: UniqueViolationMeta }).meta;
    const index = meta?.driverAdapterError?.cause?.constraint?.index;
    if (typeof index === 'string') {
      return index.includes('username');
    }

    return JSON.stringify(meta?.target ?? '').includes('username');
  }

  private async validateRegisterAccountIsUnique({
    email,
    username,
  }: Pick<RegisterInputType, 'email' | 'username'>) {
    const existingAccounts = await this.authRepository.findExistingRegisterAccounts({
      email,
      username,
    });
    const normalizedEmail = email.toLowerCase();
    const normalizedUsername = username.toLowerCase();

    const emailOwner = existingAccounts.find(
      (account) => account.email.toLowerCase() === normalizedEmail,
    );
    if (emailOwner) {
      // A register OTP issued before this account existed stays valid until it expires,
      // and this check runs before the code is validated — so the provider-only case is
      // reachable here and must not answer with the generic duplicate-email message.
      if (emailOwner.password === null) {
        throw accountUsesSocialLoginException();
      }
      throw EmailAlreadyExistsException;
    }

    if (existingAccounts.some((account) => account.username.toLowerCase() === normalizedUsername)) {
      throw UsernameAlreadyExistsException;
    }
  }

  async generateTokens({ userId, deviceId }: AccessTokenPayloadCreate) {
    const refreshTokenId = randomUUID();
    const [accessToken, refreshToken] = await Promise.all([
      this.tokenService.signAccessToken({
        userId,
        deviceId,
      }),
      this.tokenService.signRefreshToken({
        refreshTokenId,
        userId,
        deviceId,
      }),
    ]);
    const decodedRefreshToken = await this.tokenService.verifyRefreshToken(refreshToken);
    await this.authRepository.createRefreshToken({
      id: refreshTokenId,
      token: refreshToken,
      userId,
      expiresAt: new Date(decodedRefreshToken.exp * 1000),
      deviceId,
    });
    return { accessToken, refreshToken };
  }

  async refreshToken({
    refreshToken,
    userAgent,
    ip,
  }: {
    refreshToken: string;
    userAgent: string;
    ip: string;
  }) {
    try {
      const { userId } = await this.tokenService.verifyRefreshToken(refreshToken);

      const refreshTokenInDb =
        await this.authRepository.findUniqueRefreshTokenIncludeUser(refreshToken);
      if (!refreshTokenInDb) {
        throw RefreshTokenAlreadyUsedException;
      }
      if (refreshTokenInDb.user.status === UserStatus.BANNED) {
        throw AccountBlockedException;
      }
      const { deviceId } = refreshTokenInDb;

      return await this.rotateRefreshToken({
        refreshToken,
        userId,
        deviceId,
        userAgent,
        ip,
      });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('failed to refresh session', error);
      throw UnauthorizedAccessException;
    }
  }

  @Transactional()
  private async rotateRefreshToken({
    refreshToken,
    userId,
    deviceId,
    userAgent,
    ip,
  }: AccessTokenPayloadCreate & {
    refreshToken: string;
    userAgent: string;
    ip: string;
  }) {
    await this.authRepository.updateDevice(deviceId, {
      ip,
      userAgent,
    });

    await this.authRepository.deleteRefreshToken({
      token: refreshToken,
    });

    return this.generateTokens({
      userId,
      deviceId,
    });
  }

  async logout(refreshToken: string) {
    try {
      const { refreshTokenId, deviceId } = await this.tokenService.verifyRefreshToken(refreshToken);

      await this.logoutSession({
        refreshTokenId,
        deviceId,
      });
      return SUCCESS_RESPONSE;
    } catch (error) {
      if (isNotFoundPrismaError(error)) {
        throw RefreshTokenAlreadyUsedException;
      }
      if (!(error instanceof HttpException)) {
        this.logger.error('failed to log out', error);
      }
      throw UnauthorizedAccessException;
    }
  }

  @Transactional()
  private async logoutSession({
    refreshTokenId,
    deviceId,
  }: {
    refreshTokenId: string;
    deviceId: string;
  }) {
    await this.authRepository.deleteRefreshToken({
      id: refreshTokenId,
    });

    await this.authRepository.updateDevice(deviceId, {
      isActive: false,
    });
  }

  async forgotPassword(body: ForgotPasswordInputType) {
    try {
      const { email, code, newPassword } = body;

      const user = await this.authRepository.findUserByEmailInsensitive(email);
      if (!user) {
        throw EmailNotFoundException;
      }
      // Second layer, for a caller that skips the OTP request step.
      if (user.password === null) {
        throw accountUsesSocialLoginException();
      }

      await this.validateVerificationCode({
        email,
        type: TypeOfVerificationCode.FORGOT_PASSWORD,
        code,
      });

      const hashedPassword = await this.hashingService.hash(newPassword);
      await this.resetPassword({
        userId: user.id,
        password: hashedPassword,
        email: body.email,
      });
      return SUCCESS_RESPONSE;
    } catch (error) {
      if (!(error instanceof HttpException)) {
        this.logger.error('failed to reset password', error);
      }
      throw error;
    }
  }

  @Transactional()
  private async resetPassword({
    userId,
    password,
    email,
  }: {
    userId: string;
    password: string;
    email: string;
  }) {
    await this.sharedUserRepository.update(
      { id: userId },
      {
        password,
      },
    );
    await this.authRepository.deleteVerificationCode({
      email_type: {
        email,
        type: TypeOfVerificationCode.FORGOT_PASSWORD,
      },
    });
    // DEF-003
    await this.authRepository.revokeAllSessions(userId);
  }
}
