import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { SkipPermissionCheck } from '../../shared/decorators/auth.decorator.ts';
import {
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKey,
} from '../../shared/decorators/idempotency-key.decorator.ts';
import {
  CreateWithdrawalInputDTO,
  GetMyWithdrawalsInputDTO,
  GetMyWithdrawalsOutputDTO,
  WithdrawalIdParamDTO,
  WithdrawalMutationOutputDTO,
  WithdrawalOutputDTO,
} from './withdrawal.dto.ts';
import { WithdrawalService } from './withdrawal.service.ts';

// @SkipPermissionCheck() trên cả bốn route, cùng hình dạng với publisher-earnings:
// create-permissions.ts chỉ cấp quyền cho ADMIN nên route gác quyền theo vai trò sẽ trả 403
// cho mọi nhà phát hành. Bảo vệ nằm ở service — assertActivePublisher() và lọc theo
// publisherUserId lấy từ token.
@ApiTags('Withdrawals')
@ApiBearerAuth('access-token')
@Controller('withdrawals')
export class WithdrawalController {
  constructor(@Inject(WithdrawalService) private readonly withdrawalService: WithdrawalService) {}

  // 200 chứ không 201: gửi lại cùng khoá trả về đơn đã có, không tạo mới.
  @Post()
  @HttpCode(200)
  @SkipPermissionCheck()
  @ApiHeader({ name: IDEMPOTENCY_KEY_HEADER, required: true, description: 'UUID' })
  @ZodResponse({ type: WithdrawalMutationOutputDTO })
  create(
    @Body() body: CreateWithdrawalInputDTO,
    @IdempotencyKey('Error.WithdrawalIdempotencyKeyRequired') idempotencyKey: string,
    @ActiveUser('userId') publisherUserId: string,
  ) {
    return this.withdrawalService.create({ data: body, idempotencyKey, publisherUserId });
  }

  // Khai TRƯỚC :withdrawalId: Nest khớp theo thứ tự khai báo, ngược lại "me" bị đọc thành
  // id rồi fail kiểm UUID (order.controller.ts:41).
  @Get('me')
  @SkipPermissionCheck()
  @ZodResponse({ type: GetMyWithdrawalsOutputDTO })
  listMine(
    @Query() query: GetMyWithdrawalsInputDTO,
    @ActiveUser('userId') publisherUserId: string,
  ) {
    return this.withdrawalService.listMine({ publisherUserId, query });
  }

  @Get(':withdrawalId')
  @SkipPermissionCheck()
  @ZodResponse({ type: WithdrawalOutputDTO })
  findOne(
    @Param() params: WithdrawalIdParamDTO,
    @ActiveUser('userId') publisherUserId: string,
  ) {
    return this.withdrawalService.findOne({
      withdrawalId: params.withdrawalId,
      publisherUserId,
    });
  }

  // POST .../cancel chứ không DELETE: đơn không bị xoá, nó đổi trạng thái và để lại bút toán.
  @Post(':withdrawalId/cancel')
  @HttpCode(200)
  @SkipPermissionCheck()
  @ZodResponse({ type: WithdrawalMutationOutputDTO })
  cancel(
    @Param() params: WithdrawalIdParamDTO,
    @ActiveUser('userId') publisherUserId: string,
  ) {
    return this.withdrawalService.cancel({
      withdrawalId: params.withdrawalId,
      publisherUserId,
    });
  }
}
