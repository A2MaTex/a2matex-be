import { createZodDto } from 'nestjs-zod';
import {
  ChangePasswordInput,
  ProfileOutput,
  UpdatePersonalProfileInput,
} from './profile.model.ts';

export class ProfileOutputDTO extends createZodDto(ProfileOutput) {}

export class UpdatePersonalProfileInputDTO extends createZodDto(UpdatePersonalProfileInput) {}

export class ChangePasswordInputDTO extends createZodDto(ChangePasswordInput) {}
