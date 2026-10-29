import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { SkipPermissionCheck } from '../../shared/decorators/auth.decorator.ts';
import { CreateOrderInputDTO, CreateOrderOutputDTO } from './order.dto.ts';
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
}
