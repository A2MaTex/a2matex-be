import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

export const ProductNotFoundException = new NotFoundException('Error.ProductNotFound');

export const ProductAlreadyExistsException = new ConflictException('Error.ProductAlreadyExists');

export const ProductArchivedException = new ConflictException('Error.ProductArchived');

export const ProductSuspendedException = new ConflictException('Error.ProductSuspended');

export const ProductSlugConflictException = new ConflictException('Error.ProductSlugConflict');

export const ProductAccessDeniedException = new ForbiddenException('Error.ProductAccessDenied');

export const ProductLifecycleActionDeniedException = new ForbiddenException(
  'Error.ProductLifecycleActionDenied',
);

export const ProductCannotBeArchivedException = new ConflictException(
  'Error.ProductCannotBeArchived',
);

export const ProductCannotBeSuspendedException = new ConflictException(
  'Error.ProductCannotBeSuspended',
);

export const ProductCannotBeReactivatedException = new ConflictException(
  'Error.ProductCannotBeReactivated',
);

export const ProductReleaseUnavailableException = new ConflictException(
  'Error.ProductReleaseUnavailable',
);

export const ProductMediaInvalidException = new UnprocessableEntityException([
  {
    message: 'Error.ProductMediaInvalid',
    path: 'media',
  },
]);

export const ProductSuspendReasonRequiredException = new UnprocessableEntityException([
  {
    message: 'Error.ProductSuspendReasonRequired',
    path: 'reason',
  },
]);
