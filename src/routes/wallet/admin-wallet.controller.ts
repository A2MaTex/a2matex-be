import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import {
  GrantToUserInputDTO,
  GrantToUserOutputDTO,
  IssueCreditInputDTO,
  IssueCreditOutputDTO,
} from './wallet.dto.ts';
import { WalletService } from './wallet.service.ts';

@ApiTags('Wallet Admin')
@ApiBearerAuth('access-token')
@Controller('admin')
export class AdminWalletController {
  constructor(@Inject(WalletService) private readonly walletService: WalletService) {}

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
