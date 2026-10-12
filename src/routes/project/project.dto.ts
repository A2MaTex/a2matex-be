import { createZodDto } from 'nestjs-zod';
import {
  ArchiveProjectOutput,
  CreateProjectInput,
  CreateProjectOutput,
  GetProjectDetailOutput,
  GetProjectListInput,
  GetProjectListOutput,
  ProjectIdParam,
  UpdateProjectInput,
  UpdateProjectOutput,
} from './project.model.ts';

export class ProjectIdParamDTO extends createZodDto(ProjectIdParam) {}

export class CreateProjectInputDTO extends createZodDto(CreateProjectInput) {}

export class CreateProjectOutputDTO extends createZodDto(CreateProjectOutput) {}

export class GetProjectListInputDTO extends createZodDto(GetProjectListInput) {}

export class GetProjectListOutputDTO extends createZodDto(GetProjectListOutput) {}

export class GetProjectDetailOutputDTO extends createZodDto(GetProjectDetailOutput) {}

export class UpdateProjectInputDTO extends createZodDto(UpdateProjectInput) {}

export class UpdateProjectOutputDTO extends createZodDto(UpdateProjectOutput) {}

export class ArchiveProjectOutputDTO extends createZodDto(ArchiveProjectOutput) {}
