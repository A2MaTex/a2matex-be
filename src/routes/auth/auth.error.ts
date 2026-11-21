import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OAuthProviderType } from '../../shared/constants/auth.constant.ts';
import { withRequestLogMessage } from '../../shared/infrastructure/logging/request-log-context.service.js';

// OTP related errors
export const InvalidOTPException = new UnprocessableEntityException([
  {
    message: 'Error.InvalidOTP',
    path: 'code',
  },
]);

export const OTPExpiredException = new UnprocessableEntityException([
  {
    message: 'Error.OTPExpired',
    path: 'code',
  },
]);

export const FailedToSendOTPException = new UnprocessableEntityException([
  {
    message: 'Error.FailedToSendOTP',
    path: 'code',
  },
]);

// Email related errors
export const EmailAlreadyExistsException = withRequestLogMessage(
  new UnprocessableEntityException([{ message: 'Error.EmailAlreadyExists', path: 'email' }]),
  'email already exists',
);

export const UsernameAlreadyExistsException = withRequestLogMessage(
  new UnprocessableEntityException([{ message: 'Error.UsernameAlreadyExists', path: 'username' }]),
  'username already exists',
);

export const EmailNotFoundException = new UnprocessableEntityException([
  {
    message: 'Error.EmailNotFound',
    path: 'email',
  },
]);

// DEF-002
export const InvalidCredentialsException = new UnprocessableEntityException([
  {
    message: 'Error.InvalidCredentials',
    path: 'password',
  },
]);

export const EmailOrUsernameNotFoundException = new UnprocessableEntityException([
  {
    message: 'Error.EmailOrUsernameNotFound',
    path: 'account',
  },
]);

// Auth token related errors
export const RefreshTokenAlreadyUsedException = new UnauthorizedException(
  'Error.RefreshTokenAlreadyUsed',
);
export const UnauthorizedAccessException = new UnauthorizedException(
  'Error.UnauthorizedAccess',
);
export const AccountBlockedException = new ForbiddenException(
  'Error.AccountBlocked',
);

// Social login errors. 422 for anything the caller can fix, 503 for anything only
// we or the provider can fix.
export const RedirectUriNotAllowedException = withRequestLogMessage(
  new UnprocessableEntityException([
    { message: 'Error.RedirectUriNotAllowed', path: 'redirectUri' },
  ]),
  'redirect uri is not in the allowlist',
);

export const InvalidAuthorizationCodeException = withRequestLogMessage(
  new UnprocessableEntityException([
    { message: 'Error.InvalidAuthorizationCode', path: 'code' },
  ]),
  'provider rejected the authorization code',
);

export const ProviderEmailNotVerifiedException = withRequestLogMessage(
  new UnprocessableEntityException([
    { message: 'Error.ProviderEmailNotVerified', path: 'code' },
  ]),
  'provider did not confirm the email is verified',
);

export const ProviderEmailUnavailableException = withRequestLogMessage(
  new UnprocessableEntityException([
    { message: 'Error.ProviderEmailUnavailable', path: 'code' },
  ]),
  'provider returned no usable email address',
);

export const InvalidProviderEmailException = withRequestLogMessage(
  new UnprocessableEntityException([{ message: 'Error.InvalidProviderEmail', path: 'code' }]),
  'provider returned a malformed email address',
);

export const ProviderAlreadyLinkedException = withRequestLogMessage(
  new UnprocessableEntityException([
    { message: 'Error.ProviderAlreadyLinked', path: 'code' },
  ]),
  'account already has a link for this provider',
);

export const ProviderUnavailableException = new ServiceUnavailableException(
  'Error.ProviderUnavailable',
);

export const ProviderNotConfiguredException = new ServiceUnavailableException(
  'Error.ProviderNotConfigured',
);

export const UsernameGenerationExhaustedException = new ServiceUnavailableException(
  'Error.UsernameGenerationExhausted',
);

/**
 * Same answer on every password door so a provider-only account never gets several
 * different stories about itself.
 *
 * `providers` is only passed on authenticated routes. On the public doors the caller is
 * anyone with an email address, and naming the providers would turn a leaked email list
 * into a list sorted by which identity provider to impersonate. The list rides in
 * `details` because CatchEverythingFilter keeps only `message` and `path` on each error
 * item, and is joined because the filter passes through scalar detail values only.
 */
export const accountUsesSocialLoginException = (providers?: OAuthProviderType[]) => {
  const message = [{ message: 'Error.AccountUsesSocialLogin', path: 'account' }];

  return withRequestLogMessage(
    new UnprocessableEntityException(
      providers?.length ? { message, details: { providers: providers.join(',') } } : { message },
    ),
    'account has no password and signs in through a provider',
  );
};

/**
 * Role deactivation is how an account gets locked out, so the provider door has to
 * answer exactly like the password door does. No `path`: this request body has no
 * `account` field to point at.
 */
export const NoActiveRoleException = withRequestLogMessage(
  new UnprocessableEntityException([{ message: 'Error.EmailOrUsernameNotFound' }]),
  'account has no active role',
);
