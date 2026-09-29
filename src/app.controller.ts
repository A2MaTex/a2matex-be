import { Controller, Delete, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { AppService } from './app.service.js';
import { ActiveUser } from './shared/decorators/active-user.decorator.ts';
import { IsPublic, SkipPermissionCheck } from './shared/decorators/auth.decorator.js';
import { MessageResDTO } from './shared/dtos/response.dto.ts';

@ApiTags('app')
@Controller()
export class AppController {
  constructor(@Inject(AppService) private readonly appService: AppService) {}

  @Get()
  @ApiBearerAuth('access-token')
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Liveness probe for the container runtime and the reverse proxy.
   * Public and dependency-free so it answers even while the database is busy.
   */
  @Get('health')
  @IsPublic()
  getHealth() {
    return {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @Delete('permission-cache')
  @ApiBearerAuth('access-token')
  @SkipPermissionCheck()
  @ZodResponse({ type: MessageResDTO })
  clearPermissionCache(@ActiveUser('roleId') roleId: string) {
    return this.appService.clearPermissionCache(roleId);
  }
}
