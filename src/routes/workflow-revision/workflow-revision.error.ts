import { ConflictException, PayloadTooLargeException } from '@nestjs/common';

export function workflowRevisionDraftVersionConflictException(
  currentVersion: number,
): ConflictException {
  return new ConflictException({
    message: 'Error.WorkflowRevisionDraftVersionConflict',
    details: { currentVersion },
  });
}

export const WorkflowRevisionRuntimeIrRequiredException = new ConflictException(
  'Error.WorkflowRevisionRuntimeIrRequired',
);

export const WorkflowRevisionNodeDefinitionUnavailableException = new ConflictException(
  'Error.WorkflowRevisionNodeDefinitionUnavailable',
);

export const WorkflowRevisionSourceIntegrityFailedException = new ConflictException(
  'Error.WorkflowRevisionSourceIntegrityFailed',
);

export const WorkflowRevisionPayloadTooLargeException = new PayloadTooLargeException(
  'Error.WorkflowRevisionPayloadTooLarge',
);

export const WorkflowRevisionAlreadyExistsException = new ConflictException(
  'Error.WorkflowRevisionAlreadyExists',
);

export const WorkflowRevisionAssetUnsupportedException = new ConflictException(
  'Error.WorkflowRevisionAssetUnsupported',
);
