import { createZodDto } from 'nestjs-zod';
import {
  InitialAuthorizationRequest,
  ExecutionAuthorizationOutput,
} from './execution-authorization.model.ts';

export class ExecutionAuthorizationInputDTO extends createZodDto(InitialAuthorizationRequest) {}
export class ExecutionAuthorizationOutputDTO extends createZodDto(ExecutionAuthorizationOutput) {}
