import { createZodDto } from 'nestjs-zod';
import {
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
