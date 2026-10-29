import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const ProductOfferNotFoundException = new NotFoundException('Error.ProductOfferNotFound');

export const ProductOfferNotEditableException = new ConflictException(
  'Error.ProductOfferNotEditable',
);

export const ProductOfferAlreadyActiveException = new ConflictException(
  'Error.ProductOfferAlreadyActive',
);

export const ProductOfferCannotBeActivatedException = new ConflictException(
  'Error.ProductOfferCannotBeActivated',
);

export const ProductOfferCannotBeDeactivatedException = new ConflictException(
  'Error.ProductOfferCannotBeDeactivated',
);

// Same shape as CustomZodValidationPipe, for rules checked on the merged row.
export const productOfferShapeException = (issues: { message: string; path: string }[]) =>
  new UnprocessableEntityException(issues);
