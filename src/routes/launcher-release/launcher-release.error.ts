import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const LauncherReleaseNotFoundException = new NotFoundException(
  'Error.LauncherReleaseNotFound',
);

export const ActiveLauncherReleaseNotFoundException = new NotFoundException(
  'Error.ActiveLauncherReleaseNotFound',
);

export const LauncherReleaseAlreadyActiveException = new ConflictException(
  'Error.LauncherReleaseAlreadyActive',
);

export const LauncherReleaseStaticNotFoundException = new UnprocessableEntityException([
  {
    message: 'Error.StaticNotFound',
    path: 'staticId',
  },
]);
