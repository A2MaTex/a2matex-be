import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service.js';
import { IsPublic } from './shared/decorators/auth.decorator.js';

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

}
