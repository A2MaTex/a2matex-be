import { createZodDto } from 'nestjs-zod';
import { CreateOrderInput, CreateOrderOutput } from './order.model.ts';

export class CreateOrderInputDTO extends createZodDto(CreateOrderInput) {}

export class CreateOrderOutputDTO extends createZodDto(CreateOrderOutput) {}
