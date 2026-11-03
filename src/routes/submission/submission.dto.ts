import { createZodDto } from 'nestjs-zod';
import {
  CreateSubmissionInput,
  CreateSubmissionOutput,
  GetAdminSubmissionListOutput,
  GetSubmissionListInput,
  GetSubmissionListOutput,
  GetSubmissionListResponse,
  SubmissionIdParam,
} from './submission.model.ts';

export class SubmissionIdParamDTO extends createZodDto(SubmissionIdParam) {}

export class CreateSubmissionInputDTO extends createZodDto(CreateSubmissionInput) {}

export class CreateSubmissionOutputDTO extends createZodDto(CreateSubmissionOutput) {}

export class GetSubmissionListInputDTO extends createZodDto(GetSubmissionListInput) {}

export class GetSubmissionListOutputDTO extends createZodDto(GetSubmissionListOutput) {}

// Documented separately so the Admin response shape is visible in OpenAPI; the route
// returns this shape only for unrestricted callers.
export class GetAdminSubmissionListOutputDTO extends createZodDto(GetAdminSubmissionListOutput) {}

export class GetSubmissionListResponseDTO extends createZodDto(GetSubmissionListResponse) {}
