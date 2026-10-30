import { ConflictException, NotFoundException } from '@nestjs/common';

export const OrderNotFoundException = new NotFoundException('Error.OrderNotFound');

export const ProductOfferNotPurchasableException = new ConflictException(
  'Error.ProductOfferNotPurchasable',
);

export const CannotPurchaseOwnProductException = new ConflictException(
  'Error.CannotPurchaseOwnProduct',
);

export const InsufficientBalanceException = new ConflictException('Error.InsufficientBalance');
