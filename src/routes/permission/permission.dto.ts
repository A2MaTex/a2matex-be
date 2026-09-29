import { createZodDto } from 'nestjs-zod';
import {
  CreatePermissionInput,
  CreatePermissionOutput,
  DeleteManyPermissionInput,
  GetPermissionDetailOutput,
  GetPermissionListOutput,
  PermissionIdParam,
  UpdatePermissionInput,
} from './permission.model.ts';

export class PermissionIdParamDTO extends createZodDto(PermissionIdParam) {}

export class CreatePermissionInputDTO extends createZodDto(CreatePermissionInput) {}

export class CreatePermissionOutputDTO extends createZodDto(CreatePermissionOutput) {}

export class GetPermissionListOutputDTO extends createZodDto(GetPermissionListOutput) {}

export class GetPermissionDetailOutputDTO extends createZodDto(GetPermissionDetailOutput) {}

export class UpdatePermissionInputDTO extends createZodDto(UpdatePermissionInput) {}

export class DeleteManyPermissionInputDTO extends createZodDto(DeleteManyPermissionInput) {}
