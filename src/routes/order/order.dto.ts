import { createZodDto } from 'nestjs-zod';
import {
  CreateOrderInput,
  CreateOrderOutput,
  GetOrderListInput,
  GetOrderListOutput,
} from './order.model.ts';

export class CreateOrderInputDTO extends createZodDto(CreateOrderInput) {}

export class CreateOrderOutputDTO extends createZodDto(CreateOrderOutput) {}

export class GetOrderListInputDTO extends createZodDto(GetOrderListInput) {}

export class GetOrderListOutputDTO extends createZodDto(GetOrderListOutput) {}
