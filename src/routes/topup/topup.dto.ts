import { createZodDto } from 'nestjs-zod';
import {
  CreateTopUpRequestInput,
  CreateTopUpRequestOutput,
  SepayWebhookPayload,
} from './topup.model.ts';

export class CreateTopUpRequestInputDTO extends createZodDto(CreateTopUpRequestInput) {}

export class CreateTopUpRequestOutputDTO extends createZodDto(CreateTopUpRequestOutput) {}

export class SepayWebhookPayloadDTO extends createZodDto(SepayWebhookPayload) {}
