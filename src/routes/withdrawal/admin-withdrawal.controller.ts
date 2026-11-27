import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { AdminWithdrawalService } from './admin-withdrawal.service.ts';
import {
  AdminWithdrawalOutputDTO,
  GetAdminWithdrawalsInputDTO,
  GetAdminWithdrawalsOutputDTO,
  MarkPaidWithdrawalInputDTO,
  RejectWithdrawalInputDTO,
  WithdrawalIdParamDTO,
  WithdrawalMutationOutputDTO,
} from './withdrawal.dto.ts';

// Gác quyền THẬT, khác bốn route của nhà phát hành ở spec 012: những route này đọc và sửa
// dữ liệu của NGƯỜI KHÁC, nên không có danh tính người gọi nào để lọc theo. Seed phân quyền
// tự cấp cho ADMIN và không cấp cho vai trò nào khác.
//
// Hệ quả: lần deploy này BẮT BUỘC chạy seed-permissions, nếu không admin cũng nhận 403.
@ApiTags('Withdrawal Management')
@ApiBearerAuth('access-token')
@Controller('admin/withdrawals')
export class AdminWithdrawalController {
  constructor(
    @Inject(AdminWithdrawalService) private readonly service: AdminWithdrawalService,
  ) {}

  @Get()
  @ZodResponse({ type: GetAdminWithdrawalsOutputDTO })
  listAll(@Query() query: GetAdminWithdrawalsInputDTO) {
    return this.service.listAll(query);
  }

  @Post(':withdrawalId/approve')
  @HttpCode(200)
  @ZodResponse({ type: AdminWithdrawalOutputDTO })
  approve(
    @Param() params: WithdrawalIdParamDTO,
    @ActiveUser('userId') adminUserId: string,
  ) {
    return this.service.approve({ withdrawalId: params.withdrawalId, adminUserId });
  }

  // Nhận cả đơn đang chờ duyệt lẫn đơn đã duyệt: tiền chưa thật sự đi nên quản trị viên
  // phải rút lại được quyết định. Đơn đã chi thì không — tiền đã ra khỏi ngân hàng.
  @Post(':withdrawalId/reject')
  @HttpCode(200)
  @ZodResponse({ type: WithdrawalMutationOutputDTO })
  reject(
    @Param() params: WithdrawalIdParamDTO,
    @Body() body: RejectWithdrawalInputDTO,
    @ActiveUser('userId') adminUserId: string,
  ) {
    return this.service.reject({
      withdrawalId: params.withdrawalId,
      adminUserId,
      reason: body.reason,
    });
  }

  @Post(':withdrawalId/mark-paid')
  @HttpCode(200)
  @ZodResponse({ type: AdminWithdrawalOutputDTO })
  markPaid(
    @Param() params: WithdrawalIdParamDTO,
    @Body() body: MarkPaidWithdrawalInputDTO,
    @ActiveUser('userId') adminUserId: string,
  ) {
    return this.service.markPaid({
      withdrawalId: params.withdrawalId,
      adminUserId,
      bankTransferRef: body.bankTransferRef,
    });
  }
}
