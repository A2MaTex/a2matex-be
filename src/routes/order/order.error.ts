import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

// A missing or deleted Product reuses ProductNotFoundException from the Product module.

export const OrderIdempotencyKeyReusedException = new ConflictException(
  'Error.OrderIdempotencyKeyReused',
);

export const ProductOfferNotFoundException = new NotFoundException('Error.ProductOfferNotFound');

export const ProductNotPurchasableException = new ConflictException(
  'Error.ProductNotPurchasable',
);

export const OrderCustomerProfileNotFoundException = new NotFoundException(
  'Error.OrderCustomerProfileNotFound',
);

// Revoking is a moderation decision: only an Admin grant lifts it (spec 006).
export const EntitlementRevokedException = new ConflictException('Error.EntitlementRevoked');

export const EntitlementStillActiveException = new ConflictException(
  'Error.EntitlementStillActive',
);

export const OneTimeOfferAlreadyUsedException = new ConflictException(
  'Error.OneTimeOfferAlreadyUsed',
);

export const InsufficientBalanceException = new ConflictException('Error.InsufficientBalance');

// An Order of another customer answers the same way as one that never existed.
export const OrderNotFoundException = new NotFoundException('Error.OrderNotFound');

export const OrderOperationTimeoutException = new ServiceUnavailableException(
  'Error.OrderOperationTimeout',
);
