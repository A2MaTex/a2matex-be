import { createZodDto } from 'nestjs-zod';
import {
  CreateRoleInput,
  CreateRoleOutput,
  DeleteManyRoleInput,
  GetRoleDetailOutput,
  GetRoleListInput,
  GetRoleListOutput,
  GetRolePermissionsOutput,
  RoleIdParam,
  UpdateRoleInput,
  UpdateRolePermissionsInput,
} from './role.model.ts';

export class RoleIdParamDTO extends createZodDto(RoleIdParam) {}

export class CreateRoleInputDTO extends createZodDto(CreateRoleInput) {}

export class CreateRoleOutputDTO extends createZodDto(CreateRoleOutput) {}

export class GetRoleListInputDTO extends createZodDto(GetRoleListInput) {}

export class GetRoleListOutputDTO extends createZodDto(GetRoleListOutput) {}

export class GetRoleDetailOutputDTO extends createZodDto(GetRoleDetailOutput) {}

export class UpdateRoleInputDTO extends createZodDto(UpdateRoleInput) {}

export class DeleteManyRoleInputDTO extends createZodDto(DeleteManyRoleInput) {}

export class GetRolePermissionsOutputDTO extends createZodDto(GetRolePermissionsOutput) {}

export class UpdateRolePermissionsInputDTO extends createZodDto(UpdateRolePermissionsInput) {}
