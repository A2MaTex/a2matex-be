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

/**
 * A JSON object that is returned, not accepted. Stored snapshots were validated by
 * their own schema at write time and are immutable afterwards, so re-parsing them on
 * every read buys nothing and costs a deep walk: `z.record(z.string(), z.json())`
 * tries each node against a recursive union and clones the result, which is hundreds
 * of milliseconds on a large workflow graph. Re-validating also pins immutable rows
 * to the *current* schema, so bumping a snapshot version would break every historical
 * record.
 *
 * `docs` is the schema the value was written against. It documents the field in
 * OpenAPI and is never used to parse, which is what lets the stored shape and the
 * documented shape move apart over time without breaking old rows.
 */
export const zJsonObject = (docs?: z.ZodType) => {
  // Typed `unknown` so a Prisma `JsonValue` column assigns to it without a cast, which
  // keeps the response-type check between a repo select and its schema meaningful.
  // The runtime guard still rejects a column that somehow holds a scalar or array.
  const schema = z.custom<unknown>(
    (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
  );
  let documented: Record<string, unknown> | undefined;
  schema._zod.toJSONSchema = () => {
    // Resolved once, and only while the OpenAPI document is being built.
    documented ??= docs
      ? (z.toJSONSchema(docs) as Record<string, unknown>)
      : { type: 'object', additionalProperties: true };
    return documented;
  };
  return schema;
};
