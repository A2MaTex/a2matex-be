import { createZodDto } from 'nestjs-zod';
import { ValidateEditorGraphInput, WorkflowValidationOutput } from './workflow-validation.model.ts';

export class ValidateEditorGraphInputDTO extends createZodDto(ValidateEditorGraphInput) {}

export class WorkflowValidationOutputDTO extends createZodDto(WorkflowValidationOutput) {}
