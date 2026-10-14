import { z } from 'zod';
import { Project } from '../../entities/project.model.ts';
import {
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  ProjectStatus,
} from '../../shared/constants/project.constant.ts';
import { PaginationQuerySchema } from '../../shared/models/request.model.ts';

const ProjectNameInput = z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH);
const ProjectDescriptionInput = z
  .string()
  .trim()
  .max(PROJECT_DESCRIPTION_MAX_LENGTH)
  .nullable()
  .transform((description) => description || null);

export const ProjectIdParam = z
  .object({
    projectId: z.uuid(),
  })
  .strict();

export const ProjectOutput = Project.pick({
  id: true,
  publisherAccountId: true,
  name: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
});

export const CreateProjectInput = z
  .object({
    name: ProjectNameInput,
    description: ProjectDescriptionInput.optional().default(null),
  })
  .strict();

export const CreateProjectOutput = Project.pick({ id: true });

export const GetProjectListInput = PaginationQuerySchema.extend({
  status: z.enum([ProjectStatus.ACTIVE, ProjectStatus.ARCHIVED]).optional(),
}).strict();

export const GetProjectListOutput = z.object({
  items: z.array(ProjectOutput),
  totalItems: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

export const GetProjectDetailOutput = ProjectOutput;

export const UpdateProjectInput = z
  .object({
    name: ProjectNameInput.optional(),
    description: ProjectDescriptionInput.optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    message: 'At least one field is required',
  });

export type ProjectOutputType = z.infer<typeof ProjectOutput>;
export type CreateProjectInputType = z.infer<typeof CreateProjectInput>;
export type GetProjectListInputType = z.infer<typeof GetProjectListInput>;
export type GetProjectListOutputType = z.infer<typeof GetProjectListOutput>;
export type UpdateProjectInputType = z.infer<typeof UpdateProjectInput>;
