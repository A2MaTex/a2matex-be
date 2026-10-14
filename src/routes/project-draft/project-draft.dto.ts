import { createZodDto } from 'nestjs-zod';
import {
  GetProjectDraftOutput,
  SaveProjectDraftInput,
  ProjectDraftSyncOutput,
} from './project-draft.model.ts';

export class SaveProjectDraftInputDTO extends createZodDto(SaveProjectDraftInput) {}

export class ProjectDraftSyncOutputDTO extends createZodDto(ProjectDraftSyncOutput) {}

export class GetProjectDraftOutputDTO extends createZodDto(GetProjectDraftOutput) {}
