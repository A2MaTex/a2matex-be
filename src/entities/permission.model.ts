import { HTTPMethod } from './../shared/constants/role.constant.js';
import { z } from 'zod';
import { BaseWithUserFields } from './base.model.ts';

export const Permission = BaseWithUserFields.extend({
  name: z.string().max(500),
  description: z.string(),
  module: z.string().max(100),
  path: z.string().max(1000),
  method: z.enum([
    HTTPMethod.GET,
    HTTPMethod.POST,
    HTTPMethod.PUT,
    HTTPMethod.DELETE,
    HTTPMethod.PATCH,
    HTTPMethod.OPTIONS,
    HTTPMethod.HEAD,
  ]),
});

export type PermissionType = z.infer<typeof Permission>;
