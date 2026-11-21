import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import {
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKey,
} from '../../shared/decorators/idempotency-key.decorator.ts';
import {
  CreateOrderInputDTO,
  CreateOrderOutputDTO,
  GetMyOrdersInputDTO,
  GetMyOrdersOutputDTO,
  OrderIdParamDTO,
  OrderOutputDTO,
} from './order.dto.ts';
import { OrderService } from './order.service.ts';

@ApiTags('Orders')
@ApiBearerAuth('access-token')
@Controller('orders')
export class OrderController {
  constructor(@Inject(OrderService) private readonly orderService: OrderService) {}

  // The customer sends only the offer they picked: price, duration and type are read back
  // from the database inside the purchase transaction.
  @Post()
  @HttpCode(200)
  @ApiHeader({ name: IDEMPOTENCY_KEY_HEADER, required: true, description: 'UUID' })
  @ZodResponse({ type: CreateOrderOutputDTO })
  create(
    @Body() body: CreateOrderInputDTO,
    @IdempotencyKey('Error.OrderIdempotencyKeyRequired') idempotencyKey: string,
    @ActiveUser('userId') customerId: string,
  ) {
    return this.orderService.create({ data: body, idempotencyKey, customerId });
  }

  // Declared before the :orderId route on purpose: Nest matches in declaration order, and
  // the other way round "me" would be read as an order id and fail UUID validation.
  @Get('me')
  @ZodResponse({ type: GetMyOrdersOutputDTO })
  listMine(@Query() query: GetMyOrdersInputDTO, @ActiveUser('userId') customerId: string) {
    return this.orderService.listMine({ customerId, query });
  }

  @Get(':orderId')
  @ZodResponse({ type: OrderOutputDTO })
  findOne(@Param() params: OrderIdParamDTO, @ActiveUser('userId') customerId: string) {
    return this.orderService.findOne({ orderId: params.orderId, customerId });
  }
}
