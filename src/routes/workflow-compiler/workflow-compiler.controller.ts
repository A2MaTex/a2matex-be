import { Controller, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { IsPublic } from '../../shared/decorators/auth.decorator.ts';
import CustomZodValidationPipe from '../../shared/pipes/custom-zod-validation.pipe.ts';
import { ProjectIdParamDTO } from '../project/project.dto.ts';
import { CompileProjectDraftOutputDTO } from './workflow-compiler.dto.ts';
import { WorkflowCompilerService } from './workflow-compiler.service.ts';

@ApiTags('Workflow Compiler')
@Controller('projects/:projectId/draft/compile')
export class WorkflowCompilerController {
  constructor(
    @Inject(WorkflowCompilerService)
    private readonly workflowCompilerService: WorkflowCompilerService,
  ) {}

  @Post()
  @IsPublic()
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: CompileProjectDraftOutputDTO })
  compile(@Param(new CustomZodValidationPipe(ProjectIdParamDTO)) params: ProjectIdParamDTO) {
    return this.workflowCompilerService.compileProjectDraft(params.projectId);
  }
}
