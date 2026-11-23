import { Body, Controller, Get, Inject, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import {
  GetSystemSettingsOutputDTO,
  SystemSettingKeyParamDTO,
  SystemSettingOutputDTO,
  UpdateSystemSettingInputDTO,
} from './system-setting.dto.ts';
import { SystemSettingService } from './system-setting.service.ts';

// Admin-only: the permission seed assigns these routes to the ADMIN role and no other.
// There is no POST and no DELETE. The set of keys is fixed by the code-side registry, so
// creating one is a reviewed change and deleting one would stop the next boot.
@ApiTags('System Settings')
@ApiBearerAuth('access-token')
@Controller('admin/system-settings')
export class SystemSettingController {
  constructor(
    @Inject(SystemSettingService) private readonly systemSettingService: SystemSettingService,
  ) {}

  // Driven by the registry rather than the table, so a key the portal has never heard of
  // appears the moment the backend declares it.
  @Get()
  @ZodResponse({ type: GetSystemSettingsOutputDTO })
  async list() {
    return { items: await this.systemSettingService.list() };
  }

  @Patch(':key')
  @ZodResponse({ type: SystemSettingOutputDTO })
  update(
    @Param() params: SystemSettingKeyParamDTO,
    @Body() body: UpdateSystemSettingInputDTO,
    @ActiveUser('userId') adminUserId: string,
  ) {
    return this.systemSettingService.update({
      key: params.key,
      value: body.value,
      adminUserId,
    });
  }
}
