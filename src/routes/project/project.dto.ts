import { createZodDto } from 'nestjs-zod';
import {
  CreateProjectInput,
  CreateProjectOutput,
  GetProjectDetailOutput,
  GetProjectListInput,
  GetProjectListOutput,
  ProjectIdParam,
  UpdateProjectInput,
} from './project.model.ts';

export class ProjectIdParamDTO extends createZodDto(ProjectIdParam) {}

export class CreateProjectInputDTO extends createZodDto(CreateProjectInput) {}

export class CreateProjectOutputDTO extends createZodDto(CreateProjectOutput) {}

export class GetProjectListInputDTO extends createZodDto(GetProjectListInput) {}

export class GetProjectListOutputDTO extends createZodDto(GetProjectListOutput) {}

export class GetProjectDetailOutputDTO extends createZodDto(GetProjectDetailOutput) {}

export class UpdateProjectInputDTO extends createZodDto(UpdateProjectInput) {}
