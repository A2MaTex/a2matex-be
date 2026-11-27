import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { LauncherProductListOutputDTO } from './launcher.dto.ts';
import { LauncherService } from './launcher.service.ts';

@ApiTags('Launcher')
@ApiBearerAuth('access-token')
@Controller('launcher')
export class LauncherController {
  constructor(@Inject(LauncherService) private readonly launcherService: LauncherService) {}

  @Get('products')
  @Header('Cache-Control', 'no-store')
  @ZodResponse({ type: LauncherProductListOutputDTO })
  getProducts(@ActiveUser('userId') userId: string) {
    return this.launcherService.getProductList(userId);
  }
}
