import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

export const UserNotFoundException = new NotFoundException('Error.UserNotFound');

export const UserStatusConflictException = new ConflictException('Error.UserStatusConflict');

export const UserStatusTransitionDeniedException = new ConflictException('Error.UserStatusTransitionDenied');

export const UserSelfBanDeniedException = new ForbiddenException('Error.UserSelfBanDenied');

export const AdminTargetProtectedException = new ForbiddenException('Error.AdminTargetProtected');
