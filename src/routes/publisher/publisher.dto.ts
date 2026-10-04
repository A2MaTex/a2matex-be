import { createZodDto } from 'nestjs-zod';
import {
  ActivatePublisherInput,
  GetMyPublisherOutput,
  GetPublisherListInput,
  GetPublisherListOutput,
  PublicPublisherOutput,
  PublisherAccountIdParam,
  PublisherAdminDetailOutput,
  PublisherUsernameParam,
  UpdatePublisherStatusInput,
} from './publisher.model.ts';

export class PublisherAccountIdParamDTO extends createZodDto(PublisherAccountIdParam) {}

export class PublisherUsernameParamDTO extends createZodDto(PublisherUsernameParam) {}

export class GetMyPublisherOutputDTO extends createZodDto(GetMyPublisherOutput) {}

export class ActivatePublisherInputDTO extends createZodDto(ActivatePublisherInput) {}

export class GetPublisherListInputDTO extends createZodDto(GetPublisherListInput) {}

export class GetPublisherListOutputDTO extends createZodDto(GetPublisherListOutput) {}

export class PublisherAdminDetailOutputDTO extends createZodDto(PublisherAdminDetailOutput) {}

export class UpdatePublisherStatusInputDTO extends createZodDto(UpdatePublisherStatusInput) {}

export class PublicPublisherOutputDTO extends createZodDto(PublicPublisherOutput) {}
