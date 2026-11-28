import { createZodDto } from 'nestjs-zod';
import {
  InitialAuthorizationRequest,
  ExecutionAuthorizationOutput,
  RenewalAuthorizationRequest,
  RenewalAuthorizationParams,
  RenewalAuthorizationQuery,
  RenewalAuthorizationOutput,
} from './execution-authorization.model.ts';

export class ExecutionAuthorizationInputDTO extends createZodDto(InitialAuthorizationRequest) {}
export class ExecutionAuthorizationOutputDTO extends createZodDto(ExecutionAuthorizationOutput) {}
export class RenewalAuthorizationInputDTO extends createZodDto(RenewalAuthorizationRequest) {}
export class RenewalAuthorizationParamsDTO extends createZodDto(RenewalAuthorizationParams) {}
export class RenewalAuthorizationQueryDTO extends createZodDto(RenewalAuthorizationQuery) {}
export class RenewalAuthorizationOutputDTO extends createZodDto(RenewalAuthorizationOutput) {}
