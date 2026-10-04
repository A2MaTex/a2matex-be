import { createZodDto } from 'nestjs-zod';
import {
  CreateTermInput,
  CreateTermOutput,
  CurrentTermOutput,
  GetCurrentTermInput,
  GetTermDetailOutput,
  GetTermListInput,
  GetTermListOutput,
  TermIdParam,
  UpdateTermInput,
  UpdateTermStatusInput,
} from './term.model.ts';

export class TermIdParamDTO extends createZodDto(TermIdParam) {}

export class GetCurrentTermInputDTO extends createZodDto(GetCurrentTermInput) {}

export class CurrentTermOutputDTO extends createZodDto(CurrentTermOutput) {}

export class GetTermListInputDTO extends createZodDto(GetTermListInput) {}

export class GetTermListOutputDTO extends createZodDto(GetTermListOutput) {}

export class GetTermDetailOutputDTO extends createZodDto(GetTermDetailOutput) {}

export class CreateTermInputDTO extends createZodDto(CreateTermInput) {}

export class CreateTermOutputDTO extends createZodDto(CreateTermOutput) {}

export class UpdateTermInputDTO extends createZodDto(UpdateTermInput) {}

export class UpdateTermStatusInputDTO extends createZodDto(UpdateTermStatusInput) {}
