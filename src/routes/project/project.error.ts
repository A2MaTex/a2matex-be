import { ConflictException, NotFoundException } from '@nestjs/common';

export { ProjectAccessDeniedException } from '../../shared/errors/project-access.error.ts';

export const ProjectNotFoundException = new NotFoundException('Error.ProjectNotFound');

export const ProjectArchivedException = new ConflictException('Error.ProjectArchived');
