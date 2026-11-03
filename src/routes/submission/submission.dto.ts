import { createZodDto } from 'nestjs-zod';
import {
  CreateSubmissionInput,
  CreateSubmissionOutput,
  SubmissionIdParam,
} from './submission.model.ts';

export class SubmissionIdParamDTO extends createZodDto(SubmissionIdParam) {}

export class CreateSubmissionInputDTO extends createZodDto(CreateSubmissionInput) {}

export class CreateSubmissionOutputDTO extends createZodDto(CreateSubmissionOutput) {}
