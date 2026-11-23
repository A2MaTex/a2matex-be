import { createZodDto } from 'nestjs-zod';
import {
  GetSystemSettingsOutput,
  SystemSettingKeyParam,
  SystemSettingOutput,
  UpdateSystemSettingInput,
} from './system-setting.model.ts';

export class SystemSettingKeyParamDTO extends createZodDto(SystemSettingKeyParam) {}

export class UpdateSystemSettingInputDTO extends createZodDto(UpdateSystemSettingInput) {}

export class SystemSettingOutputDTO extends createZodDto(SystemSettingOutput) {}

export class GetSystemSettingsOutputDTO extends createZodDto(GetSystemSettingsOutput) {}
