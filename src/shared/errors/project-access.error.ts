import { ForbiddenException } from '@nestjs/common';

export const ProjectAccessDeniedException = new ForbiddenException('Error.ProjectAccessDenied');

export const PublisherNotActivatedException = new ForbiddenException('Error.PublisherNotActivated');

export const PublisherBlockedException = new ForbiddenException('Error.PublisherBlocked');
