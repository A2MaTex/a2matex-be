import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const NotFoundRecordException = new NotFoundException('Error.NotFound');

export const InvalidPasswordException = new UnprocessableEntityException([
  {
    message: 'Error.InvalidPassword',
    path: 'password',
  },
]);

export const InvalidStaticImageTypeException = new UnprocessableEntityException([
  {
    message: 'Error.InvalidImageType',
    path: 'image',
  },
]);

export const StaticImageVariantNotFoundException = new NotFoundException(
  'Error.ImageVariantNotFound',
);

export const VersionConflictException = new ConflictException('Error.VersionConflict');
