import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';

// 422, not 500: an empty Marketplace account is an ordinary business situation in the
// early days, not a system fault. The guard lives in the conditional UPDATE, so this is
// what the caller sees — letting the database CHECK catch it would surface a constraint
// violation and answer 500 to something entirely predictable (research.md R12).
export const SystemAccountInsufficientFundsException = new UnprocessableEntityException(
  'Error.SystemAccountInsufficientFunds',
);

// A recipient that was deleted answers the same way as one that never existed, and no
// ledger entry is written either way — an orphan entry is worse than a rejected request.
export const WalletGrantRecipientNotFoundException = new NotFoundException(
  'Error.WalletGrantRecipientNotFound',
);

// ---- Quản trị viên (spec 013) ----

export const WalletUserNotFoundException = new NotFoundException('Error.WalletUserNotFound');

export const LedgerDateRangeInvalidException = new UnprocessableEntityException(
  'Error.LedgerDateRangeInvalid',
);
