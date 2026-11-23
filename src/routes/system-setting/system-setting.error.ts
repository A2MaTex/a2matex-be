import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ZodError } from 'zod';

// A key absent from the registry is "not found" rather than a validation error: the set of
// keys is fixed in code, so the client asked for something that does not exist.
export const SystemSettingKeyNotRegisteredException = new NotFoundException(
  'Error.SystemSettingKeyNotRegistered',
);

/**
 * The value is validated against the schema of whichever key was addressed, so it cannot
 * go through the DTO pipe like an ordinary body. This reproduces the shape
 * CustomZodValidationPipe produces, so a caller sees one error contract either way.
 */
export const settingValueValidationException = (error: ZodError) =>
  new UnprocessableEntityException(
    error.issues.map((issue) => ({ ...issue, path: issue.path.join('.') })),
  );
