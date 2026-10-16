import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { SkipPermissionCheck } from '../../shared/decorators/auth.decorator.ts';
import CustomZodValidationPipe from '../../shared/pipes/custom-zod-validation.pipe.ts';
import {
  ValidateEditorGraphInputDTO,
  WorkflowValidationOutputDTO,
} from './workflow-validation.dto.ts';
import { WorkflowValidationService } from './workflow-validation.service.ts';

@ApiTags('Workflow Validation')
@ApiBearerAuth('access-token')
@Controller('workflow-validation')
export class WorkflowValidationController {
  constructor(
    @Inject(WorkflowValidationService)
    private readonly workflowValidationService: WorkflowValidationService,
  ) {}

  @Post()
  @SkipPermissionCheck()
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: WorkflowValidationOutputDTO })
  validate(
    @Body(new CustomZodValidationPipe(ValidateEditorGraphInputDTO))
    body: ValidateEditorGraphInputDTO,
  ) {
    return this.workflowValidationService.validate(body.editorGraph);
  }
}
