import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import {
  GetAdminLedgerInputDTO,
  GetAdminLedgerOutputDTO,
  GetUserWalletInputDTO,
  GrantToUserInputDTO,
  ReconciliationOutputDTO,
  UserIdParamDTO,
  UserWalletOutputDTO,
  GrantToUserOutputDTO,
  IssueCreditInputDTO,
  IssueCreditOutputDTO,
} from './wallet.dto.ts';
import { AdminWalletService } from './admin-wallet.service.ts';
import { WalletService } from './wallet.service.ts';

@ApiTags('Wallet Admin')
@ApiBearerAuth('access-token')
@Controller('admin')
export class AdminWalletController {
  constructor(
    @Inject(WalletService) private readonly walletService: WalletService,
    @Inject(AdminWalletService) private readonly adminWalletService: AdminWalletService,
  ) {}

  // ---- Đọc (spec 013) ----
  //
  // Khai route tĩnh TRƯỚC route có tham số đường dẫn: Nest khớp theo thứ tự khai báo, nên
  // đặt sau thì "reconciliation" có thể bị đọc thành một tham số.
  @Get('wallet-transactions/reconciliation')
  @ZodResponse({ type: ReconciliationOutputDTO })
  getReconciliation() {
    return this.adminWalletService.getReconciliation();
  }

  @Get('wallet-transactions')
  @ZodResponse({ type: GetAdminLedgerOutputDTO })
  listLedger(@Query() query: GetAdminLedgerInputDTO) {
    return this.adminWalletService.listLedger(query);
  }

  @Get('users/:userId/wallet')
  @ZodResponse({ type: UserWalletOutputDTO })
  getUserWallet(@Param() params: UserIdParamDTO, @Query() query: GetUserWalletInputDTO) {
    return this.adminWalletService.getUserWallet({ userId: params.userId, query });
  }

  // The money comes out of the Marketplace account, so an empty account rejects the grant
  // with 422 rather than creating value out of nothing.
  @Post('wallet-transactions/grant')
  @ZodResponse({ type: GrantToUserOutputDTO })
  grant(@Body() body: GrantToUserInputDTO, @ActiveUser('userId') createdById: string) {
    return this.walletService.grantToUser({
      userId: body.userId,
      amount: body.amount,
      note: body.note,
      createdById,
    });
  }

  // A separate permission from the grant route above, deliberately: granting is routine
  // and always funded, while issuing credit is rare and raises what the system owes
  // without any cash behind it. They should not be held by the same people by default.
  @Post('system-account/issue-credit')
  @ZodResponse({ type: IssueCreditOutputDTO })
  issueCredit(@Body() body: IssueCreditInputDTO, @ActiveUser('userId') createdById: string) {
    return this.walletService.issueCreditToSystemAccount({
      amount: body.amount,
      note: body.note,
      createdById,
    });
  }
}
