import { createParamDecorator, UnprocessableEntityException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { z } from 'zod';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

const IdempotencyKeyValue = z.uuid();

// Callers pass their own message so each module keeps the stable error name its
// contract documents, while the header name and format stay defined once here.
export const IdempotencyKey = createParamDecorator(
  (message: string | undefined, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest();
    const raw: unknown = request.headers?.[IDEMPOTENCY_KEY_HEADER];
    const parsed = IdempotencyKeyValue.safeParse(typeof raw === 'string' ? raw.trim() : raw);

    if (!parsed.success) {
      throw new UnprocessableEntityException([
        {
          message: message ?? 'Error.IdempotencyKeyRequired',
          path: IDEMPOTENCY_KEY_HEADER,
        },
      ]);
    }

    // The uniqueness claim is byte-exact, so a client that formats the same UUID
    // differently between the original request and its retry would escape it.
    return parsed.data.toLowerCase();
  },
);
