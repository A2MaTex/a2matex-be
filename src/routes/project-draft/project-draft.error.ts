import { ConflictException, PayloadTooLargeException } from '@nestjs/common';

export const ProjectDraftPayloadTooLargeException = new PayloadTooLargeException(
  'Error.ProjectDraftPayloadTooLarge',
);

export function projectDraftVersionConflictException(currentVersion: number): ConflictException {
  return new ConflictException({
    message: 'Error.ProjectDraftVersionConflict',
    details: { currentVersion },
  });
}
