import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

// A missing or deleted Product reuses ProductNotFoundException from the Product module.

export const EntitlementProductNotActiveException = new ConflictException(
  'Error.EntitlementProductNotActive',
);

export const EntitlementCustomerNotFoundException = new NotFoundException(
  'Error.EntitlementCustomerNotFound',
);

export const EntitlementInvalidExpiresAtException = new UnprocessableEntityException(
  'Error.EntitlementInvalidExpiresAt',
);

export const EntitlementNotFoundException = new NotFoundException('Error.EntitlementNotFound');

export const EntitlementAlreadyRevokedException = new ConflictException(
  'Error.EntitlementAlreadyRevoked',
);

// The loser of a race waits on a row lock, so a slow winner surfaces as a transaction
// timeout. 503 tells the client that retrying is the right answer.
export const EntitlementOperationTimeoutException = new ServiceUnavailableException(
  'Error.EntitlementOperationTimeout',
);
