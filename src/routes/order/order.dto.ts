import { createZodDto } from 'nestjs-zod';
import {
  CreateOrderInput,
  CreateOrderOutput,
  GetOrderDetailOutput,
  GetOrderListInput,
  GetOrderListOutput,
  OrderIdParam,
} from './order.model.ts';

export class OrderIdParamDTO extends createZodDto(OrderIdParam) {}

export class CreateOrderInputDTO extends createZodDto(CreateOrderInput) {}

export class CreateOrderOutputDTO extends createZodDto(CreateOrderOutput) {}

export class GetOrderListInputDTO extends createZodDto(GetOrderListInput) {}

export class GetOrderListOutputDTO extends createZodDto(GetOrderListOutput) {}

export class GetOrderDetailOutputDTO extends createZodDto(GetOrderDetailOutput) {}
