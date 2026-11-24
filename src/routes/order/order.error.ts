import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

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

// A Publisher buying their own Product would be debited the full price and credited the
// price minus commission: a guaranteed loss of exactly the commission on something they
// already own. Testing their own Product goes through the ADMIN_GRANT entitlement path,
// which moves no money.
export const CannotPurchaseOwnProductException = new ConflictException(
  'Error.CannotPurchaseOwnProduct',
);

// Falling back to a hardcoded rate would reintroduce the code-level commission that
// spec 009 exists to remove, and zero would hand the Publisher the whole amount.
export const CommissionRateUnavailableException = new ServiceUnavailableException(
  'Error.CommissionRateUnavailable',
);

// Contradicts PublisherAccount activation: the sale cannot complete if its earnings have
// nowhere to land. 500, not 503: retrying will not give the Publisher a wallet.
export const PublisherProfileNotFoundException = new InternalServerErrorException(
  'Error.PublisherProfileNotFound',
);
