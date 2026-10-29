import { ConflictException } from '@nestjs/common';

export const ProductOfferNotPurchasableException = new ConflictException(
  'Error.ProductOfferNotPurchasable',
);

export const CannotPurchaseOwnProductException = new ConflictException(
  'Error.CannotPurchaseOwnProduct',
);

export const InsufficientBalanceException = new ConflictException('Error.InsufficientBalance');
