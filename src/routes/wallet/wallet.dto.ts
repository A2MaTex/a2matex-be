import { createZodDto } from 'nestjs-zod';
import {
  GetAdminLedgerInput,
  GetUserWalletInput,
  GetAdminLedgerOutput,
  ReconciliationOutput,
  UserIdParam,
  UserWalletOutput,
  GetMyWalletTransactionsInput,
  GetMyWalletTransactionsOutput,
  GrantToUserInput,
  GrantToUserOutput,
  IssueCreditInput,
  IssueCreditOutput,
  WalletTransactionOutput,
} from './wallet.model.ts';

export class WalletTransactionOutputDTO extends createZodDto(WalletTransactionOutput) {}

export class GetMyWalletTransactionsInputDTO extends createZodDto(GetMyWalletTransactionsInput) {}
export class GetMyWalletTransactionsOutputDTO extends createZodDto(GetMyWalletTransactionsOutput) {}

export class GrantToUserInputDTO extends createZodDto(GrantToUserInput) {}
export class GrantToUserOutputDTO extends createZodDto(GrantToUserOutput) {}

export class IssueCreditInputDTO extends createZodDto(IssueCreditInput) {}
export class IssueCreditOutputDTO extends createZodDto(IssueCreditOutput) {}

export class GetAdminLedgerInputDTO extends createZodDto(GetAdminLedgerInput) {}
export class GetAdminLedgerOutputDTO extends createZodDto(GetAdminLedgerOutput) {}
export class UserIdParamDTO extends createZodDto(UserIdParam) {}
export class UserWalletOutputDTO extends createZodDto(UserWalletOutput) {}
export class ReconciliationOutputDTO extends createZodDto(ReconciliationOutput) {}
export class GetUserWalletInputDTO extends createZodDto(GetUserWalletInput) {}
