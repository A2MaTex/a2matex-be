import {
  ForbiddenException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
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
