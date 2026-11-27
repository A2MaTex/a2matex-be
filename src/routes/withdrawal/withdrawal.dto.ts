import { createZodDto } from 'nestjs-zod';
import {
  AdminWithdrawalOutput,
  CreateWithdrawalInput,
  GetAdminWithdrawalsInput,
  GetAdminWithdrawalsOutput,
  MarkPaidWithdrawalInput,
  RejectWithdrawalInput,
  GetMyWithdrawalsInput,
  GetMyWithdrawalsOutput,
  WithdrawalIdParam,
  WithdrawalMutationOutput,
  WithdrawalOutput,
} from './withdrawal.model.ts';

export class WithdrawalIdParamDTO extends createZodDto(WithdrawalIdParam) {}
export class WithdrawalOutputDTO extends createZodDto(WithdrawalOutput) {}
export class WithdrawalMutationOutputDTO extends createZodDto(WithdrawalMutationOutput) {}

export class CreateWithdrawalInputDTO extends createZodDto(CreateWithdrawalInput) {}

export class GetMyWithdrawalsInputDTO extends createZodDto(GetMyWithdrawalsInput) {}
export class GetMyWithdrawalsOutputDTO extends createZodDto(GetMyWithdrawalsOutput) {}

export class AdminWithdrawalOutputDTO extends createZodDto(AdminWithdrawalOutput) {}
export class GetAdminWithdrawalsInputDTO extends createZodDto(GetAdminWithdrawalsInput) {}
export class GetAdminWithdrawalsOutputDTO extends createZodDto(GetAdminWithdrawalsOutput) {}
export class RejectWithdrawalInputDTO extends createZodDto(RejectWithdrawalInput) {}
export class MarkPaidWithdrawalInputDTO extends createZodDto(MarkPaidWithdrawalInput) {}
