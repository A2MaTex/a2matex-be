import { createZodDto } from 'nestjs-zod';
import { MessageResSchema } from '../models/response.model.js';

export class MessageResDTO extends createZodDto(MessageResSchema) {}
