import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { SkipPermissionCheck } from '../../shared/decorators/auth.decorator.ts';
import {
  CreateOrderInputDTO,
  CreateOrderOutputDTO,
  GetOrderDetailOutputDTO,
  GetOrderListInputDTO,
  GetOrderListOutputDTO,
  OrderIdParamDTO,
} from './order.dto.ts';
import { OrderService } from './order.service.ts';

@ApiTags('Orders')
@ApiBearerAuth('access-token')
@Controller('orders')
export class OrderController {
  constructor(@Inject(OrderService) private readonly orderService: OrderService) {}

  @Post()
  @SkipPermissionCheck()
  @ZodResponse({ type: CreateOrderOutputDTO })
  create(@Body() body: CreateOrderInputDTO, @ActiveUser('userId') userId: string) {
    return this.orderService.create({ offerId: body.offerId, userId });
  }

  @Get()
  @SkipPermissionCheck()
  @ZodResponse({ type: GetOrderListOutputDTO })
  getList(@Query() query: GetOrderListInputDTO, @ActiveUser('userId') userId: string) {
    return this.orderService.getList({ query, userId });
  }

  @Get(':orderId')
  @SkipPermissionCheck()
  @ZodResponse({ type: GetOrderDetailOutputDTO })
  getDetail(@Param() params: OrderIdParamDTO, @ActiveUser('userId') userId: string) {
    return this.orderService.getDetail({ orderId: params.orderId, userId });
  }
}
