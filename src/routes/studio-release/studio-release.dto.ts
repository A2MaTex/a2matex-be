import { createZodDto } from 'nestjs-zod';
import {
  CreateStudioReleaseInput,
  CreateStudioReleaseOutput,
  CurrentStudioReleaseOutput,
  GetStudioReleaseDetailOutput,
  GetStudioReleaseListInput,
  GetStudioReleaseListOutput,
  StudioReleaseIdParam,
  UpdateStudioReleaseInput,
} from './studio-release.model.ts';

export class StudioReleaseIdParamDTO extends createZodDto(StudioReleaseIdParam) {}

export class CurrentStudioReleaseOutputDTO extends createZodDto(CurrentStudioReleaseOutput) {}

export class CreateStudioReleaseInputDTO extends createZodDto(CreateStudioReleaseInput) {}

export class CreateStudioReleaseOutputDTO extends createZodDto(CreateStudioReleaseOutput) {}

export class GetStudioReleaseListInputDTO extends createZodDto(GetStudioReleaseListInput) {}

export class GetStudioReleaseListOutputDTO extends createZodDto(GetStudioReleaseListOutput) {}

export class GetStudioReleaseDetailOutputDTO extends createZodDto(GetStudioReleaseDetailOutput) {}

export class UpdateStudioReleaseInputDTO extends createZodDto(UpdateStudioReleaseInput) {}
