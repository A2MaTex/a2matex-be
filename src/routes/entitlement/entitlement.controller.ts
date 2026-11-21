import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ActiveUser } from '../../shared/decorators/active-user.decorator.ts';
import { GetMyEntitlementsInputDTO, GetMyEntitlementsOutputDTO } from './entitlement.dto.ts';
import { EntitlementService } from './entitlement.service.ts';

@ApiTags('Entitlements')
@ApiBearerAuth('access-token')
@Controller('entitlements')
export class EntitlementController {
  constructor(
    @Inject(EntitlementService) private readonly entitlementService: EntitlementService,
  ) {}

  // My Products. Scoped by the token's user, so no OWN permission scope is needed.
  @Get('me')
  @ZodResponse({ type: GetMyEntitlementsOutputDTO })
  listMine(@Query() query: GetMyEntitlementsInputDTO, @ActiveUser('userId') userId: string) {
    return this.entitlementService.listMine({ userId, query });
  }
}
