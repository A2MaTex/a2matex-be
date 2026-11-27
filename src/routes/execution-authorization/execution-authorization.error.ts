import {
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
export const ExecutionAuthorizationDeniedException = new ForbiddenException(
  'Error.ExecutionAuthorizationDenied',
);
export const AuthorizationRequestConflictException = new ConflictException(
  'Error.AuthorizationRequestConflict',
);
export const ExecutionAuthorizationExpiredException = new ConflictException(
  'Error.ExecutionAuthorizationExpired',
);
export const ExecutionAuthorizationUnavailableException = new ServiceUnavailableException(
  'Error.ExecutionAuthorizationUnavailable',
);
export const InvalidRuntimePublicKeyException = new UnprocessableEntityException([
  { message: 'Error.InvalidRuntimePublicKey', path: 'runtimePublicKey' },
]);
