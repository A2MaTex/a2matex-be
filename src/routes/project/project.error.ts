import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

export const ProjectNotFoundException = new NotFoundException('Error.ProjectNotFound');

export const ProjectArchivedException = new ConflictException('Error.ProjectArchived');

export const ProjectAccessDeniedException = new ForbiddenException('Error.ProjectAccessDenied');
