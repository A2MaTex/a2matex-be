import { createZodDto } from 'nestjs-zod';
import { CompileProjectDraftOutput } from './workflow-compiler.model.ts';

export class CompileProjectDraftOutputDTO extends createZodDto(CompileProjectDraftOutput) {}
