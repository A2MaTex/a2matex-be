import { PayloadTooLargeException } from '@nestjs/common';

export const EditorGraphPayloadTooLargeException = new PayloadTooLargeException(
  'Error.EditorGraphPayloadTooLarge',
);
