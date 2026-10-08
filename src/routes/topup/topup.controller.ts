import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { IsPublic } from '../../shared/decorators/auth.decorator.ts';
import {
  CreateTopUpRequestInputDTO,
  CreateTopUpRequestOutputDTO,
  SepayWebhookPayloadDTO,
} from './topup.dto.ts';
import { SepayWebhookGuard } from './sepay-webhook.guard.ts';
import { TopUpService } from './topup.service.ts';

@ApiTags('Top-ups')
@Controller('topups')
export class TopUpController {
  constructor(@Inject(TopUpService) private readonly topUpService: TopUpService) {}

  @Post()
  @ApiBearerAuth('access-token')
  @ZodResponse({ type: CreateTopUpRequestOutputDTO })
  createTopUpRequest(
    @Body() body: CreateTopUpRequestInputDTO,
    @ActiveUser('userId') userId: string,
  ) {
    return this.topUpService.createTopUpRequest({ userId, amount: body.amount });
  }

  @Post('sepay/webhook')
  @IsPublic()
  @UseGuards(SepayWebhookGuard)
  @HttpCode(200)
  async handleSepayWebhook(@Body() body: SepayWebhookPayloadDTO) {
    await this.topUpService.handleIncomingTransaction(body);
    return { success: true };
  }
}
