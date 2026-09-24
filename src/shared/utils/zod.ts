import { z } from 'zod';

/**
 * `z.date()` that also documents itself for OpenAPI.
 */
export const zDate = () => {
  const schema = z.date();
  schema._zod.toJSONSchema = () => ({ type: 'string', format: 'date-time' });
  return schema;
};
