import { createZodDto } from 'nestjs-zod';
import {
  CreateWithdrawalInput,
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
