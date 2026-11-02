import { createZodDto } from 'nestjs-zod';
import {
  AdminUserStatusAction,
  AdminUserIdParam,
  GetAdminUserDetailOutput,
  GetAdminUserListInput,
  GetAdminUserListOutput,
  UpdateAdminUserStatusInput,
  UpdateAdminUserStatusOutput,
} from './user.model.ts';
import { UserStatus } from '../../shared/constants/auth.constant.ts';

export class AdminUserIdParamDTO extends createZodDto(AdminUserIdParam) {}

export class GetAdminUserListInputDTO extends createZodDto(GetAdminUserListInput) {}

export class GetAdminUserListOutputDTO extends createZodDto(GetAdminUserListOutput) {}

export class GetAdminUserDetailOutputDTO extends createZodDto(GetAdminUserDetailOutput) {}

const UpdateAdminUserStatusInputDTOBase = createZodDto(
  UpdateAdminUserStatusInput,
) as unknown as new () => object;

export class UpdateAdminUserStatusInputDTO extends UpdateAdminUserStatusInputDTOBase {
  action: (typeof AdminUserStatusAction)[keyof typeof AdminUserStatusAction];
  reason: string;
  expectedStatus: (typeof UserStatus)[keyof typeof UserStatus];
}

export class UpdateAdminUserStatusOutputDTO extends createZodDto(UpdateAdminUserStatusOutput) {}
