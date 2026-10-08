import { z } from 'zod';

/**
 * zod v4 refuses to put a Date into a JSON Schema, which would otherwise make
 * `SwaggerModule.createDocument` throw at startup. zod consults
 * `_zod.toJSONSchema` before its own type processors, so attaching that hook is
 * enough for `nestjs-zod` and `@nestjs/swagger` to render the field as a
 * date-time string. Parsing behaviour is untouched.
 */
const asDateTimeInDocs = <T extends z.ZodType>(schema: T): T => {
  schema._zod.toJSONSchema = () => ({ type: 'string', format: 'date-time' });
  return schema;
};

/** `z.date()` that documents itself as a date-time string. */
export const zDate = () => asDateTimeInDocs(z.date());

/** `z.coerce.date()` that documents itself as a date-time string. */
export const zCoerceDate = () => asDateTimeInDocs(z.coerce.date());

/**
 * `BigInt` cannot be represented in JSON Schema either (same `transform`
 * problem as above) and does not survive `JSON.stringify` on the wire, so
 * response fields backed by a Prisma `BigInt` column must go through this
 * instead of a bare `z.bigint()`.
 */
export const zBigIntAsNumber = () => {
  const schema = z.bigint().transform(Number);
  schema._zod.toJSONSchema = () => ({ type: 'integer' });
  return schema;
};
