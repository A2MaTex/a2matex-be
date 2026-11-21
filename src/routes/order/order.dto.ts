import { createZodDto } from 'nestjs-zod';
import {
  CreateOrderInput,
  CreateOrderOutput,
  GetMyOrdersInput,
  GetMyOrdersOutput,
  OrderIdParam,
  OrderOutput,
} from './order.model.ts';

export class OrderIdParamDTO extends createZodDto(OrderIdParam) {}
export class OrderOutputDTO extends createZodDto(OrderOutput) {}

export class CreateOrderInputDTO extends createZodDto(CreateOrderInput) {}
export class CreateOrderOutputDTO extends createZodDto(CreateOrderOutput) {}

export class GetMyOrdersInputDTO extends createZodDto(GetMyOrdersInput) {}
export class GetMyOrdersOutputDTO extends createZodDto(GetMyOrdersOutput) {}
