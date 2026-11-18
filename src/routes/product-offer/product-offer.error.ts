import {
  ConflictException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';

export const ProductOfferSuspendedProductException = new ConflictException(
  'Error.ProductOfferSuspendedProduct',
);

export const ProductOfferArchivedProductException = new ConflictException(
  'Error.ProductOfferArchivedProduct',
);

export const ProductSubscriptionOfferRequiredException = new ConflictException(
  'Error.ProductSubscriptionOfferRequired',
);

// Nest has no TooManyRequestsException, and a bare string would answer with a naked
// JSON string instead of the envelope every other error uses. The body still says
// nothing about remaining slots, the window or the next allowed time.
export const ProductOfferChangeRateLimitExceededException = new HttpException(
  {
    message: 'Error.ProductOfferChangeRateLimitExceeded',
    error: 'Too Many Requests',
    statusCode: HttpStatus.TOO_MANY_REQUESTS,
  },
  HttpStatus.TOO_MANY_REQUESTS,
);

// A replacement waits on the Product row lock, so a slow winner can time the loser out.
export const ProductOfferReplaceTimeoutException = new ServiceUnavailableException(
  'Error.ProductOfferReplaceTimeout',
);
