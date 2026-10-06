import { createZodDto } from 'nestjs-zod';
import {
  CreateLauncherReleaseInput,
  CreateLauncherReleaseOutput,
  CurrentLauncherReleaseOutput,
  GetLauncherReleaseDetailOutput,
  GetLauncherReleaseListInput,
  GetLauncherReleaseListOutput,
  LauncherReleaseIdParam,
  UpdateLauncherReleaseInput,
} from './launcher-release.model.ts';

export class LauncherReleaseIdParamDTO extends createZodDto(LauncherReleaseIdParam) {}

export class CurrentLauncherReleaseOutputDTO extends createZodDto(CurrentLauncherReleaseOutput) {}

export class CreateLauncherReleaseInputDTO extends createZodDto(CreateLauncherReleaseInput) {}

export class CreateLauncherReleaseOutputDTO extends createZodDto(CreateLauncherReleaseOutput) {}

export class GetLauncherReleaseListInputDTO extends createZodDto(GetLauncherReleaseListInput) {}

export class GetLauncherReleaseListOutputDTO extends createZodDto(GetLauncherReleaseListOutput) {}

export class GetLauncherReleaseDetailOutputDTO extends createZodDto(
  GetLauncherReleaseDetailOutput,
) {}

export class UpdateLauncherReleaseInputDTO extends createZodDto(UpdateLauncherReleaseInput) {}
