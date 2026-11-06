import { createZodDto } from 'nestjs-zod';
import {
  AdminUserIdParam,
  GetAdminUserDetailOutput,
  GetAdminUserListInput,
  GetAdminUserListOutput,
  UpdateAdminUserStatusInput,
} from './user.model.ts';

export class AdminUserIdParamDTO extends createZodDto(AdminUserIdParam) {}

export class GetAdminUserListInputDTO extends createZodDto(GetAdminUserListInput) {}

export class GetAdminUserListOutputDTO extends createZodDto(GetAdminUserListOutput) {}

export class GetAdminUserDetailOutputDTO extends createZodDto(GetAdminUserDetailOutput) {}

export class UpdateAdminUserStatusInputDTO extends createZodDto(UpdateAdminUserStatusInput) {}
