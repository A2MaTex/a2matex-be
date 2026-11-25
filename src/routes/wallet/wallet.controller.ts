import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { SkipPermissionCheck } from '../../shared/decorators/auth.decorator.ts';
import {
  GetMyWalletTransactionsInputDTO,
  GetMyWalletTransactionsOutputDTO,
} from './wallet.dto.ts';
import { WalletService } from './wallet.service.ts';

@ApiTags('Wallet')
@ApiBearerAuth('access-token')
@Controller('wallet-transactions')
export class WalletController {
  constructor(@Inject(WalletService) private readonly walletService: WalletService) {}

  // @SkipPermissionCheck() but still behind AccessTokenGuard: the repo cannot yet seed
  // permissions for non-ADMIN roles, so a permission-gated route here would answer 403 to
  // every customer the moment it deploys (research.md R13).
  //
  // No parameter takes a user id — the wallet is always the caller's own.
  @Get()
  @SkipPermissionCheck()
  @ZodResponse({ type: GetMyWalletTransactionsOutputDTO })
  listMine(
    @Query() query: GetMyWalletTransactionsInputDTO,
    @ActiveUser('userId') userId: string,
  ) {
    return this.walletService.listMine({ userId, query });
  }
}
