import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const ProductNotFoundException = new NotFoundException('Error.ProductNotFound');

export const ProductArchivedException = new ConflictException('Error.ProductArchived');

export const ProductSlugConflictException = new ConflictException('Error.ProductSlugConflict');

export const ProductMediaInvalidException = new UnprocessableEntityException([
  {
    message: 'Error.ProductMediaInvalid',
    path: 'media',
  },
]);
