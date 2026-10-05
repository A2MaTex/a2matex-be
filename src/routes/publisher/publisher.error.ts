import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { MissingPublisherProfileField } from './publisher.model.ts';

export const PublisherAccountNotFoundException = new NotFoundException(
  'Error.PublisherAccountNotFound',
);

export const PublicPublisherNotFoundException = new NotFoundException(
  'Error.PublicPublisherNotFound',
);

export const PublisherNotActivatedException = new ForbiddenException('Error.PublisherNotActivated');

export const PublisherBlockedException = new ForbiddenException('Error.PublisherBlocked');

export const PublisherUserNotActiveException = new ForbiddenException(
  'Error.PublisherUserNotActive',
);

export const PublisherAccessDeniedException = new ForbiddenException('Error.PublisherAccessDenied');

export const PublisherTermsNotAcceptedException = new ForbiddenException(
  'Error.PublisherTermsNotAccepted',
);

export const PublisherRoleUnavailableException = new ServiceUnavailableException(
  'Error.PublisherRoleUnavailable',
);

export const PublisherStatusConflictException = new ConflictException(
  'Error.PublisherStatusConflict',
);

export const PublisherAlreadyActivatedException = new ConflictException(
  'Error.PublisherAlreadyActivated',
);

export const PublisherTermNotActiveException = new UnprocessableEntityException([
  {
    message: 'Error.PublisherTermNotActive',
    path: 'termId',
  },
]);

export const createPublisherProfileIncompleteException = (fields: MissingPublisherProfileField[]) =>
  new UnprocessableEntityException(
    fields.map((path) => ({
      message: 'Error.PublisherProfileIncomplete',
      path,
    })),
  );
