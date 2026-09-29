import {
  ForbiddenException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';

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
export const EmailAlreadyExistsException = new UnprocessableEntityException([
  {
    message: 'Error.EmailAlreadyExists',
    path: 'email',
  },
]);

export const UsernameAlreadyExistsException = new UnprocessableEntityException([
  {
    message: 'Error.UsernameAlreadyExists',
    path: 'username',
  },
]);

export const EmailNotFoundException = new UnprocessableEntityException([
  {
    message: 'Error.EmailNotFound',
    path: 'email',
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
