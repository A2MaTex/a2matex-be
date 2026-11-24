import { createZodDto } from 'nestjs-zod';
import {
  GetPublisherEarningsInput,
  GetPublisherEarningsOutput,
  PublisherEarningSummaryOutput,
} from './publisher-earning.model.ts';

export class GetPublisherEarningsInputDTO extends createZodDto(GetPublisherEarningsInput) {}

export class GetPublisherEarningsOutputDTO extends createZodDto(GetPublisherEarningsOutput) {}

export class PublisherEarningSummaryOutputDTO extends createZodDto(
  PublisherEarningSummaryOutput,
) {}
