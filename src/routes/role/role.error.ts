import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const RoleAlreadyExistsException = new UnprocessableEntityException([
  {
    message: 'Error.RoleAlreadyExists',
    path: 'name',
  },
]);

export const RoleNotFoundException = new NotFoundException('Error.RoleNotFound');

export const ProhibitedActionOnBaseRoleException = new ForbiddenException(
  'Error.ProhibitedActionOnBaseRole',
);

export const PermissionNotFoundForRoleException = new UnprocessableEntityException([
  {
    message: 'Error.PermissionNotFound',
    path: 'permissionIds',
  },
]);
