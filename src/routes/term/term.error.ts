import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const TermNotFoundException = new NotFoundException('Error.TermNotFound');

export const ActiveTermNotFoundException = new NotFoundException('Error.ActiveTermNotFound');

export const TermAlreadyExistsException = new UnprocessableEntityException([
  {
    message: 'Error.TermAlreadyExists',
    path: 'version',
  },
]);

export const TermIsImmutableException = new ConflictException('Error.TermIsImmutable');

export const InvalidTermStatusTransitionException = new ConflictException(
  'Error.InvalidTermStatusTransition',
);

export const ActiveTermConflictException = new ConflictException('Error.ActiveTermConflict');
