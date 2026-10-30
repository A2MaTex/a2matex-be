import { ConflictException } from '@nestjs/common';

export const ProductAlreadyOwnedException = new ConflictException('Error.ProductAlreadyOwned');

export const ProductAccessRevokedException = new ConflictException('Error.ProductAccessRevoked');
