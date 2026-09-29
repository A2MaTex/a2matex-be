import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const ProfileNotFoundException = new NotFoundException('Error.ProfileNotFound');

export const CurrentPasswordInvalidException = new UnprocessableEntityException([
  {
    message: 'Error.InvalidPassword',
    path: 'currentPassword',
  },
]);

export const ConfirmNewPasswordMismatchException = new UnprocessableEntityException([
  {
    message: 'Error.ConfirmNewPasswordMismatch',
    path: 'confirmNewPassword',
  },
]);
