import { z } from 'zod';
import {
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  ProjectStatus,
} from '../shared/constants/project.constant.ts';
import { BaseWithUserFields } from './base.model.ts';

export const Project = BaseWithUserFields.extend({
  publisherAccountId: z.uuid(),
  name: z.string().min(1).max(PROJECT_NAME_MAX_LENGTH),
  description: z.string().max(PROJECT_DESCRIPTION_MAX_LENGTH).nullable(),
  status: z.enum([ProjectStatus.ACTIVE, ProjectStatus.ARCHIVED]),
});

export type ProjectType = z.infer<typeof Project>;
